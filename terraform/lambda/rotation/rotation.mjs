/**
 * rotation.mjs — Lógica de rotação da chave Resend (injeção de dependências)
 *
 * Todas as operações de I/O (AWS SDK, Resend API) são recebidas via `deps`,
 * tornando este módulo testável de forma isolada sem SDK real nem rede.
 *
 * Fluxo: Verificar Idempotência → Gerar → Validar → Persistir → Revogar
 * Qualquer falha antes da revogação preserva a chave antiga intacta.
 */

import { createKeySchema, deleteKeySchema } from "./schema.mjs"

/**
 * Executa o ciclo de rotação da chave de API do Resend.
 *
 * @param {object} params
 * @param {string} params.currentKeyToken - Token da chave atualmente ativa no Secrets Manager.
 * @param {string} params.oldKeyId        - ID da chave registrado no Parameter Store como "a ser revogada".
 * @param {string} params.secretArn       - ARN do segredo no Secrets Manager onde o novo token será persistido.
 * @param {string} params.parameterArn    - ARN do parâmetro no Parameter Store onde os metadados serão registrados.
 * @param {object} params.deps            - Dependências de I/O injetadas.
 * @param {Function} params.deps.callResendApi   - (method, path, bearerToken, body?) → { status, data }
 * @param {Function} params.deps.putSecret       - (secretArn, value) → { VersionId }
 * @param {Function} params.deps.putParameter    - (parameterArn, value) → void
 * @param {Function} params.deps.getCurrentKeyId - () → string (id da chave ativa no SM)
 */
export async function rotate({ currentKeyToken, oldKeyId, secretArn, parameterArn, deps }) {
  const { callResendApi, putSecret, putParameter, getCurrentKeyId } = deps

  // Etapa 1: Verificação de idempotência completa
  // Se o id da chave atualmente ativa no SM é igual a oldKeyId, a rotação
  // anterior já foi concluída — encerrar sem nenhum efeito colateral.
  const currentKeyId = await getCurrentKeyId()
  if (currentKeyId === oldKeyId) {
    console.info(JSON.stringify({ step: "idempotency-check", result: "already-rotated" }))
    return
  }

  // Idempotência parcial: verifica se o SM já foi atualizado com a nova chave
  // (execução anterior salvou a nova chave mas travou antes de revogar a antiga)
  // Se currentKeyToken já é uma chave válida e diferente da oldKeyId,
  // o SM foi atualizado — pular geração e ir direto para revogação.
  let newKey

  const partialIdempotency = currentKeyId !== oldKeyId
    && createKeySchema.safeParse({ id: currentKeyId, object: "api_key", token: currentKeyToken }).success

  if (partialIdempotency) {
    // SM já tem a nova chave — reconstruir newKey a partir do que sabemos
    // e pular diretamente para a revogação
    newKey = { id: currentKeyId, object: "api_key", token: currentKeyToken }
    console.info(JSON.stringify({ step: "partial-idempotency", result: "skipping-generation" }))
  } else {
    // Etapa 2: Gerar nova chave via POST /api-keys
    const createResponse = await callResendApi("POST", "/api-keys", currentKeyToken)

    if (createResponse.status < 200 || createResponse.status >= 300) {
      throw new Error(`Key creation failed with HTTP status: ${createResponse.status}`)
    }

    const createResult = createKeySchema.safeParse(createResponse.data)
    if (!createResult.success) {
      // Req 7.1, 7.5: log only field path and error code — never i.message, which
      // could embed the expected literal value and risks leaking schema internals.
      // i.code is a static machine-readable constant (e.g. "invalid_type", "too_small").
      const issues = createResult.error.issues.map(i => ({ field: i.path.join("."), code: i.code }))
      console.error(JSON.stringify({ step: "validate-create", issues }))
      throw new Error("Key creation response failed schema validation")
    }

    newKey = createResult.data
  }

  // Etapa 3: Persistir novo token no Secrets Manager
  // Somente avançar para revogação se PutSecretValue retornar VersionId não nulo.
  const putSecretResult = await putSecret(secretArn, newKey.token)
  if (!putSecretResult?.VersionId) {
    throw new Error("PutSecretValue returned no VersionId — aborting before revocation")
  }
  console.info(JSON.stringify({ step: "put-secret", result: "success" }))

  // Etapa 4: Persistir metadados no Parameter Store
  // IMPORTANTE: apenas IDs são armazenados — nunca o valor do token.
  // Req 5.2: Parameter Store não deve receber campos `token` de nenhuma das chaves.
  await putParameter(parameterArn, JSON.stringify({
    new_key_id: newKey.id,
    old_key_id: oldKeyId,
  }))
  console.info(JSON.stringify({ step: "put-parameter", result: "success" }))

  // Etapa 5: Revogar chave antiga via DELETE /api-keys/:oldKeyId
  // Usa newKey.token como Bearer (a chave válida atual) e oldKeyId como alvo.
  // Falha aqui NÃO reverte escritas AWS — é uma falha suave com log de aviso.
  let deleteResponse
  try {
    deleteResponse = await callResendApi("DELETE", `/api-keys/${oldKeyId}`, newKey.token)
  } catch (err) {
    // Timeout de rede ou erro — log de aviso, encerrar com sucesso (escritas AWS estão confirmadas)
    console.warn(JSON.stringify({ step: "revoke-old-key", result: "network-error", error: err.name }))
    return
  }

  // HTTP 404 = chave já revogada (idempotente) — sucesso
  if (deleteResponse.status === 404) {
    console.warn(JSON.stringify({ step: "revoke-old-key", result: "already-revoked" }))
    return
  }

  // Resposta não-2xx (exceto 404) — log de aviso, encerrar com sucesso
  if (deleteResponse.status < 200 || deleteResponse.status >= 300) {
    console.warn(JSON.stringify({ step: "revoke-old-key", result: "unexpected-status", status: deleteResponse.status }))
    return
  }

  // Validar schema da resposta de deleção
  const deleteResult = deleteKeySchema.safeParse(deleteResponse.data)
  if (!deleteResult.success) {
    const issues = deleteResult.error.issues.map(i => ({ field: i.path.join("."), code: i.code }))
    console.warn(JSON.stringify({ step: "revoke-old-key", result: "schema-invalid", issues }))
    return
  }

  console.info(JSON.stringify({ step: "revoke-old-key", result: "success" }))
  // Função encerra aqui — rotação completa
}
