---
inclusion: always
---

# Tecnologia

## Stack

- **terraform** `1.16.6`, fixado em `.terraform-version`.
- **IAM** com privilégio mínimo absoluto, permissões restritas ao ARN exato do segredo no Secrets Manager (proibido *).
- **provider aws** `>= 6.0, < 7.0`
- **Rotação nativa do Secrets Manager** para agendar e acionar a lambda.
- **lambda** sempre utiliza Node.js como padrão (`nodejs24.x`) e uso da  da biblioteca **Zod** antes de qualquer tentativa de injeção no Secrets Manager, o payload de resposta da API DEVE ser sempre validado.
**Idempotência e Fallback** - O fluxo deve ser: Gerar Nova Chave -> Validar com Zod -> Salvar como `AWSPENDING` -> Testar -> Promover a `AWSCURRENT` -> Revogar Chave Antiga na API. Se qualquer passo falhar, a chave antiga não deve ser apagada da AWS.

## Decisões

- Cada serviço tem um único segredo no Secrets Manager, com todos os seus dados em JSON.
- Nenhum valor de chave fica no state nem no plan: o valor inicial entra só por variável `ephemeral` em argumento write-only (`secret_string_wo`), nunca em `secret_string` nem em `*.tfvars`.
- Mensagens de erro e logs da Lambda nunca incluem chaves nem respostas do provedor.
- Exemplos de variáveis usam `.tfvars.example`, porque `*.tfvars` é ignorado pelo Git.

## Proibido
- Usar AWS CloudFormation.

## Fontes de documentação

- Serviços AWS: MCP `aws-mcp` do `aws-core` (no Kiro, power `aws-core`; no Claude Code, plugin `aws-core`).
- Terraform e provider: MCP oficial da HashiCorp (no Kiro, `power-terraform-skill-terraform-mcp-server`; no Claude Code, `terraform`, em `.mcp.json`).
- Proibido web fetch para docs AWS ou Terraform.