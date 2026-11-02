# Implementation Plan: resend-api-key

## Overview

Adiciona o Resend como primeiro serviço do núcleo `api-key-rotation`. Execute depois do checkpoint final do núcleo.

## Tasks

- [x] 1. Implementar o adaptador em `terraform/lambda/rotation/adapters/resend.mjs`
  - [x] 1.1 Criar `secretSchema`, `createKeySchema`, `listKeysSchema` e `deleteKeySchema`
    - _Requirements: 1.1, 3.1, 3.2, 3.3_
  - [x] 1.2 Implementar `create` com `POST /api-keys`, `name`, `permission`, timeout de 10 s e retorno de apenas `api_key` e `key_id`
    - _Requirements: 1.2, 2.1, 2.2, 2.3_
  - [x] 1.3 Implementar `test` com `GET /api-keys` usando a chave pendente
    - _Requirements: 4.1, 4.2_
  - [x] 1.4 Implementar `revoke` com `DELETE /api-keys/{key_id}`, tratando 404 como já revogada
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 1.5 Registrar `resend` em `adapters/index.mjs` e em `local.rotation_adapters`, e excluir `adapters/resend.test.mjs` do pacote
    - _Requirements: 6.1_

- [x] 2. Testar o adaptador em `terraform/lambda/rotation/adapters/resend.test.mjs`
  - [x] 2.1 Cobrir os schemas com as respostas da documentação do Resend, incluindo o formato real de `created_at`
    - _Requirements: 1.1, 3.1, 3.2, 3.3_
  - [x] 2.2 Cobrir `create`, `test` e `revoke` com `fetch` simulado: chamadas corretas, cada falha e nenhum token em mensagens de erro
    - _Requirements: 1.2, 2.1, 2.2, 2.3, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 2.3 Rodar dois ciclos seguidos com o adaptador real e o Secrets Manager simulado, conferindo a chave revogada em cada um
    - _Requirements: 2.1, 4.1, 5.1_

- [x] 3. Checkpoint — Executar testes do adaptador
  - Execute `node --test terraform/lambda/rotation/rotation.test.mjs terraform/lambda/rotation/adapters/resend.test.mjs` para confirmar que todos os testes passam. Pergunte ao usuário se tiver dúvidas.

- [x] 4. Atualizar exemplo e documentação
  - [x] 4.1 Atualizar `terraform/examples/basic/` para uma instância com `service_name = "resend"`, sem chave real
    - _Requirements: 6.1_
  - [x] 4.2 Criar a seção do Resend no `README.md`: JSON inicial, permissão `full_access`, alerta sobre o OTP e leitura com nova tentativa em 401
    - _Requirements: 6.2, 6.3, 6.4_

- [x] 5. Checkpoint final — Validar módulo com Resend
  - Execute `terraform -chdir=terraform validate` e `terraform -chdir=terraform/examples/basic validate`, confirme que nenhum exemplo contém chave real e revise o adaptador contra os critérios de aceite. Pergunte ao usuário se tiver dúvidas.

## Pendências

- [ ] Executar o teste real em ambiente de teste, com chave de teste e com confirmação do operador: primeiro `apply`, ativação, `rotate-secret`, rótulos, revogação no Resend e novo `apply` sem alterações.
- [ ] Confirmar no teste real o status retornado pelo `DELETE /api-keys/{id}`, que a documentação não especifica.
- [ ] Alterar a SaaS_Application, no outro projeto, para ler o Service_Secret antes de ativar a rotação em produção.

## Notes

- A chave de produção só deve ser usada depois do teste real e da mudança na SaaS_Application.
- `name` e `permission` vêm da documentação pública do Resend.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5"] },
    { "id": 3, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 4, "tasks": ["4.1", "4.2"] }
  ]
}
```
