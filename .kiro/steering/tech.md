---
inclusion: always
---

# Tecnologia

## Stack

- **terraform** `1.17.1`, fixado em `.terraform-version`.
- **IAM** com privilégio mínimo absoluto, permissões restritas aos ARNs exatos do Secrets Manager e SSM (proibido *).
- **provider aws** `>= 6.0, < 7.0`
- **EventBridge** cron para acionar lambda.
- **lambda** sempre utiliza Node.js como padrão (`nodejs24.x`) e uso da  da biblioteca **Zod** antes de qualquer tentativa de injeção no Secrets Manager ou Parameter Store, o payload de resposta da API DEVE ser sempre validado.
**Idempotência e Fallback** - O fluxo deve ser: Gerar Nova Chave -> Validar com Zod -> Salvar Secrets Manager/SSM -> Revogar Chave Antiga na API. Se qualquer passo falhar, a chave antiga não deve ser apagada da AWS.

## Decisões

- Parameter Store guarda apenas configuração não sensível; chaves ficam só no Secrets Manager.
- Nenhum valor de chave passa pelo Terraform, para não ficar no state: criar `aws_secretsmanager_secret` sem `secret_version` com valor.
- Mensagens de erro e logs da Lambda nunca incluem chaves nem respostas do provedor.
- Exemplos de variáveis usam `.tfvars.example`, porque `*.tfvars` é ignorado pelo Git.

## Proibido
- Usar AWS CloudFormation.

## Fontes de documentação

- Terraform e provider: MCP `power-terraform-terraform`.
- Serviços AWS: MCP `power-aws-core-aws-mcp`.
- Proibido web fetch para docs AWS ou Terraform.