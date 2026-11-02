---
inclusion: always
---

# Estrutura
| Caminho | Conteúdo |
|---|---|
| `terraform/versions.tf` | Versões do Terraform e do provider |
| `terraform/variables.tf`, `terraform/outputs.tf` | Interface do módulo |
| `terraform/main.tf` | Secrets Manager |
| `terraform/iam.tf` | Role e policies da Lambda (ARNs exatos) |
| `terraform/rotation.tf` | Rotação nativa do Secrets Manager e permissão de invocação |
| `terraform/lambda.tf` | `archive_file` + `aws_lambda_function` |
| `terraform/lambda/rotation/index.mjs` | Handler executado dentro da Lambda (runtime) |
| `terraform/lambda/rotation/rotation.mjs` | Etapas da rotação, com dependências injetadas |
| `terraform/lambda/rotation/adapters/` | Um adaptador por serviço, com seus schemas Zod |
| `terraform/lambda/rotation/rotation.test.mjs` | Testes unitários |
| `terraform/lambda/rotation/package.json` | Dependência `zod` |
| `terraform/examples/basic/` | Exemplo de uso do módulo |

## Mapa de diretórios

| Caminho | Conteúdo |
|---|---|
| `versions.tf`, `variables.tf`, `main.tf`, `outputs.tf` | Módulo Terraform |
| `lambda/rotation/rotation.mjs` | Etapas da rotação, com dependências injetadas |
| `lambda/rotation/index.mjs` | Handler e integração com o AWS SDK |
| `lambda/rotation/rotation.test.mjs` | Testes unitários da rotação |
| `examples/basic/` | Exemplo de uso do módulo |
