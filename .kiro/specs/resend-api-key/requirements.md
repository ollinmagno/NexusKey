# Requirements Document

## Introduction

Esta spec adiciona o Resend ao NexusKey, como primeiro serviço do núcleo definido em `api-key-rotation`. Ela cobre apenas o que é específico do Resend: o formato do segredo e as chamadas à API para criar, testar e revogar chaves. Agendamento, etapas da rotação, IAM e infraestrutura são responsabilidade do núcleo.

A SaaS_Application usa o Resend para enviar e-mails, inclusive códigos OTP de login. Por isso, uma troca de chave não pode interromper o envio.

## Glossary

- **Resend_Adapter**: Service_Adapter do Resend, conforme o contrato do requisito 12 de `api-key-rotation`.
- **Resend_API**: API HTTP do Resend utilizada para criar, listar e deletar chaves de API.
- **Service_Secret**: Segredo do Resend no Secrets Manager, conforme definido em `api-key-rotation`.
- **Current_Key**: Chave de API do Resend contida na versão `AWSCURRENT` do Service_Secret.
- **New_Key**: Chave de API do Resend gerada na rotação e contida na versão `AWSPENDING` do Service_Secret.
- **Previous_Key**: Chave de API do Resend contida na versão `AWSPREVIOUS` do Service_Secret.
- **Zod_Schema**: Schema de validação definido com a biblioteca Zod.
- **Terraform_Example**: Configuração raiz de exemplo em `terraform/examples/basic/`.
- **README**: Arquivo `README.md` na raiz do repositório.
- **SaaS_Application**: Aplicação Node.js do operador, executada na mesma conta AWS, que usa a chave do Resend.

## Requirements

### Requirement 1: Formato do Segredo

**User Story:** Como operador de infraestrutura, quero guardar a chave e o seu identificador juntos, para que a chave anterior possa ser revogada sem outro local de armazenamento.

#### Acceptance Criteria

1. THE Zod_Schema SHALL definir o Service_Secret como objeto contendo `api_key` (string que corresponde ao padrão `^re_[A-Za-z0-9_]+$` com comprimento mínimo de 10 caracteres) e `key_id` (string não vazia).
2. THE Resend_Adapter SHALL retornar para gravação apenas os campos `api_key` e `key_id`.

---

### Requirement 2: Criação da Nova Chave

**User Story:** Como operador de infraestrutura, quero que o adaptador crie uma nova chave no Resend, para que a rotação não dependa de ação manual.

#### Acceptance Criteria

1. WHEN o núcleo solicita uma nova credencial, THE Resend_Adapter SHALL realizar uma requisição `POST /api-keys` à Resend_API usando a Current_Key como Bearer token, com `name` no formato `nexuskey-<data e hora UTC>` e até 50 caracteres, `permission` igual a `full_access` e timeout de 10 segundos.
2. WHEN a Resend_API retorna uma resposta 2xx à criação, THE Resend_Adapter SHALL validar o payload com o Zod_Schema de criação e extrair `id` e `token`.
3. IF a resposta tiver status diferente de 2xx, falhar na validação, atingir o timeout ou falhar por erro de rede, THEN THE Resend_Adapter SHALL reportar falha ao núcleo.

---

### Requirement 3: Validação das Respostas

**User Story:** Como engenheiro de segurança, quero que as respostas do Resend sejam validadas antes do uso, para evitar persistência de dados malformados ou inesperados.

#### Acceptance Criteria

1. THE Zod_Schema SHALL definir a resposta de `POST /api-keys` como objeto contendo `id` (string não vazia), `object` (string literal `"api_key"`) e `token` (mesmas regras de `api_key` do critério 1.1).
2. THE Zod_Schema SHALL definir a resposta de `GET /api-keys` como objeto contendo `object` (string), `has_more` (booleano) e `data` (array de objetos, cada um contendo `id` (string não vazia), `name` (string) e `created_at` (string não vazia)).
3. THE Zod_Schema SHALL definir a resposta de `DELETE /api-keys/{id}` como objeto contendo `object` (string literal `"api_key"`), `id` (string não vazia) e `deleted` (booleano literal `true`).

---

### Requirement 4: Teste da Nova Chave

**User Story:** Como operador de infraestrutura, quero confirmar que a nova chave funciona antes da promoção, para que o envio de e-mails não seja interrompido.

#### Acceptance Criteria

1. WHEN o núcleo solicita o teste, THE Resend_Adapter SHALL realizar uma requisição `GET /api-keys` usando a New_Key como Bearer token, com timeout de 10 segundos, e validar a resposta com o Zod_Schema de listagem.
2. IF a resposta tiver status diferente de 2xx, falhar na validação, atingir o timeout ou falhar por erro de rede, THEN THE Resend_Adapter SHALL reportar falha ao núcleo.

---

### Requirement 5: Revogação da Chave Anterior

**User Story:** Como engenheiro de segurança, quero revogar a chave anterior pelo identificador, para não deixar chaves antigas ativas.

#### Acceptance Criteria

1. WHEN o núcleo solicita a revogação, THE Resend_Adapter SHALL realizar uma requisição `DELETE /api-keys/{id}` à Resend_API usando a chave informada pelo núcleo como Bearer token e o `key_id` da Previous_Key como identificador, com timeout de 10 segundos.
2. WHEN a Resend_API retorna status 2xx à deleção, THE Resend_Adapter SHALL validar o payload com o Zod_Schema de deleção.
3. IF a Resend_API retornar HTTP 404 na deleção, THEN THE Resend_Adapter SHALL informar ao núcleo que a Previous_Key já estava revogada.
4. IF a deleção retornar outro status diferente de 2xx, falhar na validação, atingir o timeout ou falhar por erro de rede, THEN THE Resend_Adapter SHALL reportar falha ao núcleo.
5. THE Resend_Adapter SHALL usar sempre o `key_id` como identificador da chave a revogar, nunca o valor do token.

---

### Requirement 6: Uso e Documentação

**User Story:** Como operador de infraestrutura, quero um exemplo e instruções específicas do Resend, para ativar a rotação sem interromper o envio de códigos OTP.

#### Acceptance Criteria

1. THE Terraform_Example SHALL mostrar uma instância do módulo com `service_name = "resend"` e valores de exemplo que não contenham chave real.
2. THE README SHALL mostrar o JSON inicial do Resend, com `api_key` e `key_id`, e informar que a chave inicial precisa ter permissão `full_access`.
3. THE README SHALL alertar que a primeira rotação revoga a chave inicial e que, se a SaaS_Application ainda a estiver usando, o envio de e-mails e de códigos OTP é interrompido.
4. THE README SHALL mostrar como a SaaS_Application lê o campo `api_key` do Service_Secret e o relê ao receber HTTP 401 da Resend_API.
