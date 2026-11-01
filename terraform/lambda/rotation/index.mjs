/**
 * index.mjs — Bootstrap e dependências concretas da Lambda NexusKey
 *
 * Instancia os clientes AWS SDK v3 e expõe as funções de I/O concretas
 * que serão injetadas em `rotate()` pelo handler (task 9.2).
 *
 * Separação de responsabilidades:
 *  - index.mjs  → I/O real (AWS SDK, fetch), handler de entrada
 *  - rotation.mjs → lógica de negócio pura, sem dependências de I/O diretas
 */

import { rotate } from "./rotation.mjs"

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager"

import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm"

// ---------------------------------------------------------------------------
// Clientes AWS SDK v3
// Instanciados uma única vez no módulo (fora do handler) para reutilização
// entre invocações quentes da Lambda.
// ---------------------------------------------------------------------------

const smClient = new SecretsManagerClient({})
const ssmClient = new SSMClient({})

// ---------------------------------------------------------------------------
// callResendApi
// ---------------------------------------------------------------------------

/**
 * Realiza uma requisição HTTP à Resend API com timeout de 10 segundos.
 *
 * @param {string}  method      - Método HTTP (ex: "POST", "DELETE").
 * @param {string}  path        - Caminho do endpoint (ex: "/api-keys").
 * @param {string}  bearerToken - Token de autenticação Bearer.
 * @param {object}  [body]      - Corpo da requisição (serializado como JSON quando presente).
 * @returns {Promise<{ status: number, data: unknown }>}
 * @throws {Error} Em caso de timeout (AbortError) ou falha de rede.
 */
export async function callResendApi(method, path, bearerToken, body) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(`https://api.resend.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const data = await response.json()
    return { status: response.status, data }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// putSecret
// ---------------------------------------------------------------------------

/**
 * Salva um novo valor no segredo existente do Secrets Manager.
 *
 * Req 4.1: persiste apenas o campo `token` (string bruta), nunca objetos compostos.
 * Req 7.5: esta função não loga o valor recebido.
 *
 * @param {string} secretArn - ARN exato do segredo no Secrets Manager.
 * @param {string} value     - Token da nova chave (string bruta, ex: "re_abc123...").
 * @returns {Promise<{ VersionId: string }>}
 * @throws {Error} Em falha AWS (propagada para o handler).
 */
export async function putSecret(secretArn, value) {
  const result = await smClient.send(
    new PutSecretValueCommand({
      SecretId: secretArn,
      SecretString: value,
    })
  )

  return { VersionId: result.VersionId }
}

// ---------------------------------------------------------------------------
// putParameter
// ---------------------------------------------------------------------------

/**
 * Atualiza o parâmetro no SSM Parameter Store com os metadados de rotação.
 *
 * Req 5.1, 5.2: armazena apenas IDs (`new_key_id` e `old_key_id`), nunca tokens.
 *
 * @param {string} parameterArn - ARN (ou nome) exato do parâmetro no Parameter Store.
 * @param {string} value        - Valor a ser escrito (JSON com new_key_id e old_key_id).
 * @returns {Promise<void>}
 * @throws {Error} Em falha AWS (propagada para o handler).
 */
export async function putParameter(parameterArn, value) {
  await ssmClient.send(
    new PutParameterCommand({
      Name: parameterArn,
      Value: value,
      Type: "String",
      Overwrite: true,
    })
  )
}

// ---------------------------------------------------------------------------
// getParameter
// ---------------------------------------------------------------------------

/**
 * Lê o valor atual do parâmetro SSM e o retorna como objeto JavaScript.
 *
 * Usado pelo handler (index.mjs, task 9.2) para construir a closure
 * `getCurrentKeyId` injetada em `rotate()`:
 *
 *   const ssmValue = await getParameter(parameterArn)
 *   const getCurrentKeyId = () => ssmValue?.new_key_id ?? ""
 *
 * Req 5.1: o parâmetro SSM contém `{ new_key_id, old_key_id }`.
 * Na primeira execução, o valor pode ser o placeholder `{}` — nesse caso
 * `new_key_id` será `undefined` e a closure retornará `""`.
 *
 * @param {string} parameterArn - ARN (ou nome) exato do parâmetro no Parameter Store.
 * @returns {Promise<{ new_key_id?: string, old_key_id?: string }>}
 * @throws {Error} Em falha AWS (propagada para o handler).
 */
export async function getParameter(parameterArn) {
  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: parameterArn,
      WithDecryption: false,
    })
  )

  try {
    return JSON.parse(result.Parameter?.Value ?? "{}")
  } catch {
    // Valor não é JSON válido — retornar objeto vazio para que o handler
    // trate como primeira execução (new_key_id ausente → getCurrentKeyId retorna "").
    return {}
  }
}

// ---------------------------------------------------------------------------
// getSecretValue
// ---------------------------------------------------------------------------

/**
 * Lê o token atual armazenado no Secrets Manager.
 *
 * Usado pelo handler (task 9.2) para obter `currentKeyToken` antes de
 * chamar `rotate()`.
 *
 * Req 7.1: esta função não loga o valor retornado.
 *
 * @param {string} secretArn - ARN exato do segredo no Secrets Manager.
 * @returns {Promise<string>} Token bruto (string, ex: "re_abc123...").
 * @throws {Error} Em falha AWS ou se o segredo não possuir valor (propagada para o handler).
 */
export async function getSecretValue(secretArn) {
  const result = await smClient.send(
    new GetSecretValueCommand({
      SecretId: secretArn,
    })
  )

  if (!result.SecretString) {
    throw new Error("Secret has no SecretString value")
  }

  return result.SecretString
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

const SECRET_ARN = process.env.SECRET_ARN
const PARAMETER_ARN = process.env.PARAMETER_ARN

/**
 * Handler principal da Lambda NexusKey.
 *
 * Req 7.4: loga apenas `{ error: err.name, step: currentStep }` em JSON —
 *          nunca token, stack trace ou resposta do provedor.
 * Req 8.1: relança o erro após o log para que a Lambda marque a invocação
 *          como falha e o EventBridge/CloudWatch possa acionar alarmes.
 *
 * Fluxo (Req 3.1 — idempotência):
 *  1. Lê `currentKeyToken` do Secrets Manager (chave ativa atual).
 *  2. Lê metadados de rotação do SSM (`new_key_id` / `old_key_id`).
 *  3. Constrói as dependências injetáveis e chama `rotate()`.
 *
 * @param {unknown} _event - Evento do EventBridge (não utilizado).
 * @returns {Promise<void>}
 */
export const handler = async (_event) => {
  let currentStep = "init"
  try {
    // 1. Token da chave ativa no Secrets Manager
    currentStep = "get-secret"
    const currentKeyToken = await getSecretValue(SECRET_ARN)

    // 2. Metadados de rotação no SSM Parameter Store
    currentStep = "get-parameter"
    const ssmValue = await getParameter(PARAMETER_ARN)

    // Na primeira execução o SSM contém `{}` → old_key_id ausente → ""
    const oldKeyId = ssmValue?.old_key_id ?? ""

    // 3. Dependências injetáveis para rotate()
    const deps = {
      callResendApi,
      putSecret,
      putParameter,
      getCurrentKeyId: () => ssmValue?.new_key_id ?? "",
    }

    currentStep = "rotate"
    await rotate({
      currentKeyToken,
      oldKeyId,
      secretArn: SECRET_ARN,
      parameterArn: PARAMETER_ARN,
      deps,
    })
  } catch (err) {
    // Req 7.4: apenas nome da classe de erro e step estático — sem payload, sem stack
    console.error(JSON.stringify({
      error: err.name,
      step: currentStep,
    }))
    throw err // Req 8.1: relança para marcar invocação como falha
  }
}
