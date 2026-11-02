# Implementation Plan: api-key-rotation

## Overview

Reescreve o núcleo do NexusKey para a rotação nativa do Secrets Manager: um segredo em JSON e uma instância do módulo por serviço, com o que é específico de cada serviço isolado em um adaptador. As tasks 1 a 13 descrevem a arquitetura anterior e estão em `## Substituídas`.

## Tasks

- [x] 14. Reestruturar a interface do módulo Terraform
  - [x] 14.1 Reescrever `terraform/variables.tf` com `service_name`, `enable_rotation`, `rotation_schedule`, `initial_secret`, `initial_secret_version`, `log_retention_days`, `tags` e `local.rotation_adapters` vazia, com seus blocos `validation`
    - _Requirements: 1.3, 9.1, 9.2, 9.5, 9.7_
  - [x] 14.2 Reescrever `terraform/main.tf` com o segredo, a versão inicial por `secret_string_wo` com `ignore_changes = [version_stages]`, e a política de leitura, removendo o parâmetro SSM e movendo o grupo de logs para `lambda.tf`
    - _Requirements: 6.2, 9.3, 10.3, 11.1, 11.3_
  - [x] 14.3 Reescrever `terraform/outputs.tf` com `secret_name`, `secret_arn` sensível, `reader_policy_arn`, `rotate_command` e os outputs condicionais da Lambda
    - _Requirements: 6.3, 9.7, 10.4, 11.2_

- [x] 15. Tornar a rotação condicional
  - [x] 15.1 Reescrever `terraform/iam.tf` com `count`, exatamente duas políticas inline e `data.aws_region.current.region`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.4_
  - [x] 15.2 Reescrever `terraform/lambda.tf` com `count`, grupo de logs, `SERVICE_NAME` no ambiente e exclusão dos testes do pacote
    - _Requirements: 1.2, 9.4, 9.8_
  - [x] 15.3 Criar `terraform/rotation.tf` com `aws_lambda_permission` e `aws_secretsmanager_secret_rotation`, e apagar `terraform/eventbridge.tf`
    - _Requirements: 1.1, 7.5, 9.4, 10.1_
  - [x] 15.4 Reescrever `terraform/examples/basic/` com a região como variável e os novos parâmetros do módulo
    - _Requirements: 9.6_

- [x] 16. Checkpoint — Validar infraestrutura Terraform
  - Execute `terraform -chdir=terraform validate` e `terraform -chdir=terraform/examples/basic validate`. Confirme que `terraform/*.tf` não cita SSM, EventBridge nem `parameter_arn`, e que `Resource` só usa o sufixo `:*` do grupo de logs. Pergunte ao usuário se tiver dúvidas.

- [x] 17. Implementar o núcleo da Lambda
  - [x] 17.1 Criar `terraform/lambda/rotation/adapters/index.mjs` com `getAdapter(serviceName)` e o contrato documentado, inicialmente sem adaptadores
    - _Requirements: 3.2, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - [x] 17.2 Reescrever `terraform/lambda/rotation/rotation.mjs` com a normalização de `Step` e as pré-condições comuns
    - _Requirements: 1.4, 1.5, 8.2, 8.3_
  - [x] 17.3 Implementar `createSecret`, com revogação pendente, criação pelo adaptador e gravação em `AWSPENDING`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.3, 5.4, 8.1, 10.2_
  - [x] 17.4 Implementar `setSecret` e `testSecret` pelas operações do adaptador
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 17.5 Implementar `finishSecret`, com promoção e revogação
    - _Requirements: 4.4, 5.1, 5.2, 5.3, 5.5, 8.4, 8.5_
  - [x] 17.6 Reescrever `terraform/lambda/rotation/index.mjs` com o I/O real do Secrets Manager e o handler, removendo o SSM e `schema.mjs`
    - _Requirements: 1.2, 6.1, 6.4_

- [x] 18. Testar o núcleo em `terraform/lambda/rotation/rotation.test.mjs`
  - [x] 18.1 Criar o Secrets Manager e o adaptador simulados e cobrir o ciclo completo e dois ciclos seguidos
    - _Requirements: 2.1, 2.3, 2.4, 4.1, 4.2, 4.4, 5.1_
  - [x] 18.2 Cobrir a reexecução de cada etapa, as interrupções e a nova tentativa de revogação no ciclo seguinte
    - _Requirements: 2.2, 2.5, 4.3, 5.2, 5.3, 5.4, 8.1, 8.3, 8.4, 8.5_
  - [x] 18.3 Cobrir `Step` inválido e nas duas formas, rotação desativada, valor inicial inválido, adaptador sem operações opcionais, adaptador inexistente e ausência de segredos nos logs
    - _Requirements: 1.4, 1.5, 3.1, 3.3, 5.5, 6.1, 6.4, 8.2, 10.2, 12.3, 12.5_

- [x] 19. Checkpoint — Executar testes do núcleo
  - Execute `node --test terraform/lambda/rotation/rotation.test.mjs` para confirmar que todos os testes passam. Pergunte ao usuário se tiver dúvidas.

- [x] 20. Documentar a operação no `README.md`
  - [x] 20.1 Descrever a execução local, a sequência de configuração inicial, o alerta sobre a primeira rotação e a recuperação de `AWSPENDING`
    - _Requirements: 9.8, 10.5, 10.6, 10.7, 10.8_
  - [x] 20.2 Descrever a leitura pelo SaaS em Node.js, o cache de até 5 minutos e a nova leitura em erro de autenticação
    - _Requirements: 11.4, 11.5_
  - [x] 20.3 Descrever como adicionar um serviço e o uso sem rotação
    - _Requirements: 9.4, 12.7_

- [x] 21. Checkpoint final — Validar o núcleo
  - Execute `terraform -chdir=terraform validate`, `terraform -chdir=terraform/examples/basic validate` e `node --test terraform/lambda/rotation/rotation.test.mjs`. Revise o código contra os critérios de aceite, percorrendo estado inicial, reexecução e dados no formato real. Pergunte ao usuário se tiver dúvidas.

## Pendências

- [ ] Comprovar em teste real, com a spec `resend-api-key`, o que `testSecret` recebe ao ativar a rotação, se um `apply` depois da rotação não altera `AWSCURRENT`, se `initial_secret` nulo é aceito nos `apply` seguintes, o que ocorre com `initial_secret_version` maior que 0 sem valor informado (o `validate` aceita) e o formato real de `Step`.
- [x] Conferir em um `plan` com rotação ativa, na spec `resend-api-key`, se o pacote da Lambda contém `zod` e não contém testes. O `plan` passou das validações, e o pacote gerado com as mesmas regras de exclusão, extraído, contém `zod` 4.6.7, carrega o adaptador e não contém testes.

## Notes

- A ordem é núcleo, depois `resend-api-key`.
- A numeração começa em 14 porque o título completo é a chave do histórico de execução.
- Nenhum valor de credencial pode aparecer em código, logs, outputs, state ou exemplos.
- Testes verdes e `terraform validate` não comprovam o comportamento na AWS.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["14.1"] },
    { "id": 1, "tasks": ["14.2", "14.3", "15.1"] },
    { "id": 2, "tasks": ["15.2", "15.3"] },
    { "id": 3, "tasks": ["15.4"] },
    { "id": 4, "tasks": ["17.1"] },
    { "id": 5, "tasks": ["17.2"] },
    { "id": 6, "tasks": ["17.3", "17.4", "17.5"] },
    { "id": 7, "tasks": ["17.6"] },
    { "id": 8, "tasks": ["18.1"] },
    { "id": 9, "tasks": ["18.2", "18.3"] },
    { "id": 10, "tasks": ["20.1", "20.2", "20.3"] }
  ]
}
```

## Substituídas

Tasks e pendências da arquitetura anterior, mantidas como registro. Elas não fazem mais parte do plano, e as referências a requisitos usam a numeração antiga.


- [x] 1. Criar estrutura base do módulo Terraform
  - [x] 1.1 Criar `terraform/versions.tf` com bloco `terraform { required_version }` fixando Terraform 1.17.1 e bloco `required_providers` com `aws >= 6.0, < 7.0`
    - _Requirements: 10.1_
  - [x] 1.2 Criar `terraform/variables.tf` com variáveis obrigatórias (`secret_arn`, `parameter_arn`, `rotation_schedule`) e opcionais (`function_name`, `log_retention_days`, `tags`), cada uma com atributo `description` e blocos `validation` conforme especificado
    - `rotation_schedule`: regex `^(rate|cron)\(` no bloco `validation`
    - `function_name`: validação de máximo 64 caracteres
    - `log_retention_days`: conjunto de valores aceitos pelo CloudWatch Logs
    - `secret_arn` e `parameter_arn`: validação de não vazio
    - _Requirements: 1.3, 8.5, 10.1, 10.2, 10.4_
  - [x] 1.3 Criar `terraform/outputs.tf` com os quatro outputs (`lambda_function_arn`, `lambda_function_name`, `secret_arn`, `log_group_name`), marcando `secret_arn` com `sensitive = true` e todos com `description`
    - _Requirements: 7.3, 10.4_

- [x] 2. Implementar recursos principais em `terraform/main.tf`
  - [x] 2.1 Declarar `aws_secretsmanager_secret` sem nenhum recurso `aws_secretsmanager_secret_version` associado, aplicando `var.tags`
    - _Requirements: 4.5, 7.2_
  - [x] 2.2 Declarar `aws_ssm_parameter` com tipo `String` (não `SecureString`), valor inicial de placeholder `{}`, e `overwrite = true`
    - _Requirements: 5.2_
  - [x] 2.3 Declarar `aws_cloudwatch_log_group` com nome `/aws/lambda/${var.function_name}` e `retention_in_days = var.log_retention_days`
    - _Requirements: 10.2_

- [x] 3. Implementar IAM com privilégio mínimo em `terraform/iam.tf`
  - [x] 3.1 Declarar `aws_iam_role` com `assume_role_policy` permitindo `lambda.amazonaws.com` assumir a role
    - _Requirements: 8.1_
  - [x] 3.2 Declarar a primeira política inline (`aws_iam_role_policy`) para Secrets Manager: ações `secretsmanager:GetSecretValue` e `secretsmanager:PutSecretValue` com `Resource` apontando para `var.secret_arn` exato (sem wildcard)
    - _Requirements: 8.1, 8.4_
  - [x] 3.3 Declarar a segunda política inline para SSM Parameter Store: ações `ssm:GetParameter` e `ssm:PutParameter` com `Resource` apontando para `var.parameter_arn` exato (sem wildcard)
    - _Requirements: 8.2, 8.4_
  - [x] 3.4 Declarar a terceira política inline para CloudWatch Logs: ações `logs:CreateLogGroup`, `logs:CreateLogStream` e `logs:PutLogEvents` com `Resource` no formato `arn:aws:logs:<region>:<account_id>:log-group:/aws/lambda/<function_name>:*` construído via `data.aws_caller_identity` e `data.aws_region`
    - Exatamente três políticas inline, sem nenhuma política adicional
    - _Requirements: 8.3, 8.6_

- [x] 4. Implementar agendamento em `terraform/eventbridge.tf`
  - [x] 4.1 Declarar `aws_cloudwatch_event_rule` com `schedule_expression = var.rotation_schedule` e `state = "ENABLED"`
    - _Requirements: 1.1_
  - [x] 4.2 Declarar `aws_cloudwatch_event_target` apontando para a Lambda e `aws_lambda_permission` concedendo ao EventBridge permissão de invocar a função
    - _Requirements: 1.2_

- [x] 5. Implementar empacotamento e função Lambda em `terraform/lambda.tf`
  - [x] 5.1 Declarar `data "archive_file"` empacotando o diretório `lambda/rotation/` em arquivo `.zip` com `output_path` dentro do diretório `terraform/`
    - _Requirements: 1.2_
  - [x] 5.2 Declarar `aws_lambda_function` com `runtime = "nodejs24.x"`, `timeout = 300`, `handler = "index.handler"`, `role = aws_iam_role.this.arn`, `logging_config { log_format = "JSON" }` e referência ao `archive_file`
    - _Requirements: 1.2, 7.4_

- [x] 6. Checkpoint — Validar infraestrutura Terraform
  - Execute `terraform init` e `terraform validate` no diretório `terraform/` para confirmar que toda a infraestrutura é sintaticamente correta, as validações de variáveis funcionam e não há `aws_secretsmanager_secret_version` declarado. Pergunte ao usuário se tiver dúvidas.

- [x] 7. Criar schemas Zod em `terraform/lambda/rotation/schema.mjs`
  - [x] 7.1 Criar `package.json` em `terraform/lambda/rotation/` declarando `zod` como dependência com versão exata (ex: `"3.25.67"`) e `"type": "module"`
    - _Requirements: 3.1_
  - [x] 7.2 Implementar `schema.mjs` exportando `createKeySchema`, `listKeysSchema` e `deleteKeySchema` conforme especificado no design
    - `createKeySchema`: `id` string não vazia, `object` literal `"api_key"`, `token` regex `^re_[A-Za-z0-9_]+$` mínimo 10 chars
    - `listKeysSchema`: `object` string, `has_more` booleano, `data` array com `id`, `name`, `created_at` (ISO 8601)
    - `deleteKeySchema`: `object` literal `"api_key"`, `id` string não vazia, `deleted` literal `true`
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 8. Implementar lógica de rotação em `terraform/lambda/rotation/rotation.mjs`
  - [x] 8.1 Implementar e exportar a função `rotate({ currentKeyToken, oldKeyId, deps })` com verificação de idempotência: se `getCurrentKeyId()` retornar valor igual a `oldKeyId`, encerrar sem efeito colateral
    - _Requirements: 9.1_
  - [x] 8.2 Implementar etapa de geração: `POST /api-keys` via `deps.callResendApi` com timeout 10s, validar resposta com `createKeySchema`; abortar ciclo sem modificar AWS se status não 2xx, timeout ou falha Zod
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.4, 3.5_
  - [x] 8.3 Implementar etapa de idempotência parcial: se `currentKeyToken` já for a nova chave (SM atualizado mas revogação pendente), pular geração e ir diretamente para revogação usando `oldKeyId` do Parameter Store
    - _Requirements: 9.2_
  - [x] 8.4 Implementar etapa de persistência: `deps.putSecret(secretArn, newKey.token)` e verificar `VersionId` não nulo; abortar sem revogar em caso de falha
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 8.5 Implementar etapa de metadados: `deps.putParameter(parameterArn, { new_key_id, old_key_id })`; abortar sem revogar em caso de falha
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 8.6 Implementar etapa de revogação: `DELETE /api-keys/:oldKeyId` com `newKey` como Bearer token, validar com `deleteKeySchema`; HTTP 404 e falha Zod encerram com sucesso + log de aviso, sem reverter escritas AWS
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 9.3, 9.4_
  - [x] 8.7 Garantir que nenhuma mensagem de log dentro de `rotation.mjs` inclua valores de tokens, payloads brutos ou stack traces; logar apenas nomes de campos, tipos esperados e strings estáticas de progresso
    - _Requirements: 7.1, 7.5_

- [x] 9. Implementar handler em `terraform/lambda/rotation/index.mjs`
  - [x] 9.1 Instanciar `SecretsManagerClient` e `SSMClient` do AWS SDK v3 e implementar as funções de I/O concretas (`callResendApi`, `putSecret`, `putParameter`, `getCurrentKeyId`) que serão injetadas em `rotate()`
    - _Requirements: 2.1, 4.1, 5.1_
  - [x] 9.2 Implementar `export const handler` que busca `currentKeyToken` via `GetSecretValue` e `oldKeyId` via `GetParameter`, chama `rotate()` com as dependências injetadas, e captura exceções logando apenas `{ error: err.name, step: currentStep }` em JSON antes de relançar
    - _Requirements: 7.4, 8.1_

- [x] 10. Escrever testes unitários em `terraform/lambda/rotation/rotation.test.mjs`
  - [x] 10.1 Implementar testes dos schemas Zod (`schema.mjs`): validação positiva e negativa para `createKeySchema`, `listKeysSchema` e `deleteKeySchema`, cobrindo campos ausentes, tipos errados, literais errados e regex de token inválido
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 10.2 Implementar teste do caminho feliz: nova chave criada, SM atualizado, Parameter Store atualizado, chave antiga revogada — verificar que todas as deps foram chamadas na ordem correta
    - _Requirements: 2.1, 4.1, 5.1, 6.1_
  - [x] 10.3 Implementar teste de idempotência completa: `currentKeyId === oldKeyId` → nenhuma dep chamada além de `getCurrentKeyId`
    - _Requirements: 9.1_
  - [x] 10.4 Implementar teste de idempotência parcial: SM já atualizado, Parameter Store pendente → pula geração e vai direto para revogação
    - _Requirements: 9.2_
  - [x] 10.5 Implementar testes de falha em cada ponto de quebra: falha Zod na criação, `PutSecretValue` lança erro, `PutParameter` lança erro — verificar que `callResendApi(DELETE)` nunca é invocado nestes casos
    - _Requirements: 2.3, 4.4, 5.3_
  - [x] 10.6 Implementar testes de falha na revogação: DELETE retorna não 2xx e DELETE retorna 404 — verificar que a função retorna sem erro (sem reverter escritas AWS)
    - _Requirements: 6.3, 6.4, 9.3_

- [x] 11. Checkpoint — Executar testes e validar Lambda
  - Execute `node --test terraform/lambda/rotation/rotation.test.mjs` para confirmar que todos os testes passam. Pergunte ao usuário se tiver dúvidas.

- [x] 12. Criar exemplo de uso em `terraform/examples/basic/`
  - [x] 12.1 Criar `terraform/examples/basic/main.tf` com bloco `module "nexuskey"` referenciando `../..` e passando valores de exemplo para todas as variáveis obrigatórias e opcionais
    - _Requirements: 10.3_
  - [x] 12.2 Criar `terraform/examples/basic/terraform.tfvars.example` com valores sintaticamente válidos para todas as variáveis, de forma que `terraform validate` passe quando usado com o módulo
    - _Requirements: 10.3_
  - [x] 12.3 Criar `terraform/examples/basic/versions.tf` declarando os requisitos de versão para o exemplo
    - _Requirements: 10.3_

- [x] 13. Checkpoint final — Validar módulo completo
  - Execute `terraform validate` em `terraform/` e em `terraform/examples/basic/` para confirmar ausência de erros. Confirme que nenhum arquivo `.tf` contém `aws_secretsmanager_secret_version` nem wildcards (`*`) em elementos `Resource` de políticas IAM. Pergunte ao usuário se tiver dúvidas.

### Pendências antigas

As tasks acima passaram nos testes e no `terraform validate`, mas isso não comprova que a rotação funciona em uso real. Estes problemas seguem sem correção e bloqueiam o uso em produção:

- [ ] `rotation.mjs` não gera chave nova: o estado inicial `{}` é tratado como já rotacionado, e qualquer `new_key_id` com token `re_` válido pula o `POST`. Sem `old_key_id`, o `DELETE` é chamado com ID vazio.
- [ ] `rotation.mjs` grava o `old_key_id` anterior em vez do ID da chave substituída.
- [ ] `rotation.test.mjs` usa um token fora do formato `re_` no caminho feliz e não cobre o estado inicial `{}`.
- [ ] `aws_ssm_parameter.this` não ignora mudanças em `value`: um novo `apply` deve restaurar `{}`.
- [ ] A Lambda e o IAM usam `var.secret_arn` e `var.parameter_arn`, que podem não ser os recursos criados pelo módulo.
- [ ] `iam.tf` usa `data.aws_region.current.name`, obsoleto no provider AWS 6.
- [ ] Conferir na documentação do Resend se `POST /api-keys` exige `name` e se a resposta traz `object: "api_key"`.
