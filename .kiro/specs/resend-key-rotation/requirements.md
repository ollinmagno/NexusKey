# Requirements Document

## Introduction

O **NexusKey** é um módulo Terraform que provisiona uma arquitetura serverless na AWS para rotacionamento automatizado e seguro da chave de API do Resend. Uma Lambda Function (Node.js 24.x) é acionada periodicamente pelo EventBridge, gera uma nova chave via API do Resend, valida o payload com Zod, persiste a nova chave no Secrets Manager e registra metadados não sensíveis no Parameter Store e, somente após sucesso de todos esses passos, revoga a chave antiga. Nenhum valor de chave trafega pelo Terraform state.

## Glossary

- **Rotation_Lambda**: Função AWS Lambda (Node.js 24.x) responsável por executar o ciclo de rotação da chave.
- **Resend_API**: API HTTP do Resend utilizada para criar, listar e deletar chaves de API.
- **Current_Key**: Chave de API do Resend ativa no momento da execução, armazenada no Secrets Manager.
- **New_Key**: Nova chave de API gerada pelo Resend durante o ciclo de rotação.
- **Old_Key_ID**: Identificador (`id`) da chave a ser revogada, persistido no Parameter Store.
- **Secrets_Manager**: Serviço AWS Secrets Manager onde o valor da chave ativa é armazenado.
- **Parameter_Store**: AWS Systems Manager Parameter Store onde configurações não sensíveis são armazenadas (nome da chave, `Old_Key_ID`).
- **Zod_Schema**: Schema de validação definido com a biblioteca Zod aplicado ao payload de resposta da Resend_API antes de qualquer escrita na AWS.
- **EventBridge_Rule**: Regra do Amazon EventBridge com expressão cron que aciona a Rotation_Lambda periodicamente.
- **IAM_Role**: Role AWS IAM atribuída à Rotation_Lambda com permissões de privilégio mínimo restritas a ARNs exatos.

## Requirements

### Requirement 1: Agendamento Periódico da Rotação

**User Story:** Como operador de infraestrutura, quero que a rotação de chave seja disparada automaticamente em um intervalo configurável, para que não seja necessário nenhum processo manual.

#### Acceptance Criteria

1. THE EventBridge_Rule SHALL ter o atributo `schedule_expression` configurado com o valor exato fornecido na variável `rotation_schedule`.
2. WHEN a Rotation_Lambda é invocada pela EventBridge_Rule, THE Rotation_Lambda SHALL executar o ciclo de rotação e retornar sem erro dentro de 300 segundos.
3. IF a variável `rotation_schedule` contiver um valor que não seja uma expressão `rate()` ou `cron()` válida do EventBridge, THEN THE Terraform_Module SHALL falhar durante o `terraform validate` com uma mensagem de erro que identifica o nome da variável e o valor rejeitado.

---

### Requirement 2: Geração de Nova Chave via Resend API

**User Story:** Como operador de infraestrutura, quero que a Rotation_Lambda crie uma nova chave no Resend antes de revogar a antiga, para garantir continuidade de serviço.

#### Acceptance Criteria

1. WHEN o ciclo de rotação é iniciado, THE Rotation_Lambda SHALL realizar uma requisição `POST /api-keys` à Resend_API usando a Current_Key como Bearer token, com timeout de 10 segundos.
2. WHEN a Resend_API retorna uma resposta à requisição de criação, THE Rotation_Lambda SHALL validar o payload de resposta contra o Zod_Schema correspondente antes de prosseguir.
3. IF a validação do Zod_Schema falhar na resposta de criação, THEN THE Rotation_Lambda SHALL encerrar o ciclo sem modificar nenhum recurso na AWS e sem revogar a Current_Key.
4. IF a Resend_API retornar status HTTP diferente de 2xx na criação, THEN THE Rotation_Lambda SHALL encerrar o ciclo sem modificar nenhum recurso na AWS e sem revogar a Current_Key.
5. WHEN o payload de criação for validado com sucesso, THE Rotation_Lambda SHALL extrair o identificador único e o valor do token da nova chave do payload validado.
6. IF a requisição `POST /api-keys` atingir o timeout de 10 segundos ou falhar por erro de rede, THEN THE Rotation_Lambda SHALL encerrar o ciclo sem modificar nenhum recurso na AWS, sem revogar a Current_Key e sem realizar novas tentativas.

---

### Requirement 3: Validação de Schema com Zod

**User Story:** Como engenheiro de segurança, quero que todos os payloads recebidos da Resend API sejam validados com Zod antes de qualquer escrita na AWS, para evitar persistência de dados malformados ou inesperados.

#### Acceptance Criteria

1. THE Zod_Schema SHALL definir o formato esperado para a resposta de `POST /api-keys`: objeto contendo `id` (string não vazia), `object` (string literal `"api_key"`), e `token` (string que corresponde ao padrão `^re_[A-Za-z0-9_]+$` com comprimento mínimo de 10 caracteres).
2. THE Zod_Schema SHALL definir o formato esperado para a resposta de `GET /api-keys`: objeto contendo `object` (string), `has_more` (booleano) e `data` (array de objetos, cada objeto contendo `id` (string não vazia), `name` (string) e `created_at` (string no formato ISO 8601)).
3. THE Zod_Schema SHALL definir o formato esperado para a resposta de `DELETE /api-keys/{id}`: objeto contendo `object` (string literal `"api_key"`), `id` (string não vazia) e `deleted` (booleano literal `true`).
4. WHEN qualquer resposta da Resend_API não satisfizer o Zod_Schema correspondente, THE Rotation_Lambda SHALL registrar um log de erro contendo apenas o nome do campo inválido e o tipo esperado, sem incluir o payload bruto da resposta nem o valor de nenhuma chave, e encerrar o ciclo imediatamente sem prosseguir para o próximo passo.
5. THE Rotation_Lambda SHALL aplicar a validação Zod em todas as três operações da Resend_API (criação, listagem e deleção) antes de utilizar os dados retornados.

---

### Requirement 4: Persistência da Nova Chave no Secrets Manager

**User Story:** Como operador de infraestrutura, quero que o valor da nova chave seja salvo no Secrets Manager imediatamente após validação, para que aplicações dependentes possam recuperá-la sem interrupção.

#### Acceptance Criteria

1. WHEN o Zod_Schema valida com sucesso o payload de criação, THE Rotation_Lambda SHALL chamar `PutSecretValue` na versão existente do segredo identificado pelo ARN na variável `secret_arn`, salvando o campo `token` da nova chave.
2. WHEN a chamada `PutSecretValue` retornar com sucesso, THE Rotation_Lambda SHALL verificar que a resposta contém um `VersionId` não nulo antes de avançar para a etapa de escrita no Parameter_Store.
3. WHILE a chamada `PutSecretValue` está em andamento, THE Rotation_Lambda não SHALL invocar nenhuma chamada de revogação na Resend_API.
4. IF a chamada `PutSecretValue` retornar erro, THEN THE Rotation_Lambda SHALL encerrar o ciclo sem alterar o valor corrente do segredo e sem realizar qualquer chamada de revogação na Resend_API.
5. THE Terraform_Module não SHALL declarar nenhum recurso `aws_secretsmanager_secret_version` nos arquivos Terraform do módulo, mantendo todo valor de chave fora do Terraform state.

---

### Requirement 5: Registro de Metadados no Parameter Store

**User Story:** Como operador de infraestrutura, quero que o identificador da nova chave e o identificador da chave anterior sejam registrados no Parameter Store, para que seja possível rastrear o histórico de rotações sem expor valores sensíveis.

#### Acceptance Criteria

1. WHEN a chamada `PutSecretValue` no Secrets_Manager for concluída com sucesso e o `VersionId` não nulo for confirmado, THE Rotation_Lambda SHALL salvar tanto o `id` da New_Key quanto o `id` da chave que estava previamente ativa no parâmetro do Parameter_Store definido pelo ARN na variável `parameter_arn`.
2. THE Rotation_Lambda SHALL armazenar no Parameter_Store apenas os campos `id` (identificadores) das chaves, nunca os campos `token` (valores das chaves) de nenhuma das duas chaves.
3. IF a chamada `PutParameter` no Parameter_Store retornar erro ou se o ARN na variável `parameter_arn` estiver ausente ou inválido, THEN THE Rotation_Lambda SHALL retornar erro, preservar o valor corrente do Secrets_Manager sem modificação e não realizar nenhuma chamada de revogação na Resend_API.

---

### Requirement 6: Revogação da Chave Antiga na Resend API

**User Story:** Como engenheiro de segurança, quero que a chave antiga seja revogada na Resend somente após a nova chave ter sido salva com sucesso na AWS, para garantir que não exista janela de indisponibilidade.

#### Acceptance Criteria

1. WHEN a escrita no Secrets_Manager e no Parameter_Store forem concluídas com sucesso, THE Rotation_Lambda SHALL realizar uma requisição `DELETE /api-keys/{id}` à Resend_API usando a New_Key como Bearer token e o Old_Key_ID como identificador da chave a ser revogada, com timeout de 10 segundos.
2. WHEN a Resend_API retorna resposta à requisição de deleção, THE Rotation_Lambda SHALL validar o payload contra o Zod_Schema de deleção antes de registrar o ciclo como encerrado com sucesso.
3. IF a validação do Zod_Schema falhar na resposta de deleção, THEN THE Rotation_Lambda SHALL registrar um log de aviso indicando que a revogação não pôde ser confirmada e encerrar com sucesso, sem reverter as escritas já realizadas na AWS.
4. IF a Resend_API retornar status HTTP diferente de 2xx na requisição de deleção ou se o timeout de 10 segundos for atingido, THEN THE Rotation_Lambda SHALL registrar um log de aviso e encerrar com sucesso, sem reverter as escritas já realizadas na AWS.
5. THE Rotation_Lambda SHALL utilizar o Old_Key_ID recuperado do Parameter_Store no início do ciclo como identificador da chave a ser revogada, nunca o valor do token.

---

### Requirement 7: Segurança e Não Exposição de Chaves

**User Story:** Como engenheiro de segurança, quero que nenhum valor de chave apareça em logs, no Terraform state ou em outputs, para que credenciais sensíveis não sejam expostas acidentalmente.

#### Acceptance Criteria

1. THE Rotation_Lambda SHALL omitir de todas as mensagens de log os valores de chaves e payloads brutos da Resend_API, permitindo registrar no máximo o nome do campo ou o tipo do valor, nunca o conteúdo.
2. THE Terraform_Module não SHALL declarar nenhum recurso `aws_secretsmanager_secret_version` nos arquivos Terraform do módulo.
3. THE Terraform_Module SHALL marcar com `sensitive = true` todo output que contenha ou derive de um ARN de segredo do Secrets Manager.
4. IF uma exceção não tratada ocorrer na Rotation_Lambda, THEN THE Rotation_Lambda SHALL registrar apenas o nome da classe do erro e texto estático, excluindo explicitamente stack traces, objetos de resposta e propriedades que possam conter valores de chaves.
5. THE Rotation_Lambda SHALL omitir de logs gerados durante operações de escrita no Secrets_Manager e no Parameter_Store qualquer valor que corresponda ao padrão de token da chave (`^re_[A-Za-z0-9_]+$`).

---

### Requirement 8: IAM com Privilégio Mínimo

**User Story:** Como engenheiro de segurança, quero que a IAM Role da Lambda tenha permissões restritas a ARNs exatos, para minimizar o raio de impacto de uma eventual comprometimento.

#### Acceptance Criteria

1. THE IAM_Role SHALL conceder à Rotation_Lambda permissão `secretsmanager:GetSecretValue` e `secretsmanager:PutSecretValue` somente para o ARN exato do segredo definido pela variável `secret_arn`, rejeitando qualquer requisição a ARNs diferentes desse valor.
2. THE IAM_Role SHALL conceder à Rotation_Lambda permissão `ssm:GetParameter` e `ssm:PutParameter` somente para o ARN exato do parâmetro definido pela variável `parameter_arn`, rejeitando qualquer requisição a ARNs diferentes desse valor.
3. THE IAM_Role SHALL conceder à Rotation_Lambda permissão `logs:CreateLogGroup`, `logs:CreateLogStream` e `logs:PutLogEvents` somente para o ARN do grupo de logs da própria função, construído no formato `arn:aws:logs:<region>:<account_id>:log-group:/aws/lambda/<function_name>:*`.
4. THE Terraform_Module SHALL proibir o uso de wildcards (`*`) em qualquer elemento `Resource` das políticas IAM da Rotation_Lambda, resultando em falha de validação do plano Terraform (`terraform validate` retorna erro) caso um wildcard seja detectado.
5. IF a variável `secret_arn` ou `parameter_arn` for fornecida com valor vazio ou nulo, THEN THE Terraform_Module SHALL falhar na fase de `terraform validate` com mensagem de erro indicando qual variável está inválida, sem provisionar nenhum recurso.
6. THE IAM_Role SHALL conter exatamente três políticas inline, uma para Secrets Manager, uma para SSM Parameter Store e uma para CloudWatch Logs, sem nenhuma política adicional anexada.

---

### Requirement 9: Idempotência do Ciclo de Rotação

**User Story:** Como operador de infraestrutura, quero que uma segunda execução da Lambda durante o mesmo ciclo não cause duplicação de chaves ou estados inconsistentes, para que o sistema seja resiliente a reexecuções.

#### Acceptance Criteria

1. WHEN a Rotation_Lambda é invocada e o campo `id` da chave atualmente armazenada no Secrets_Manager é igual ao Old_Key_ID registrado no Parameter_Store, THE Rotation_Lambda SHALL detectar que a rotação já foi concluída e encerrar sem criar nova chave, sem salvar no Secrets_Manager e sem revogar na Resend_API.
2. IF a Rotation_Lambda falhar após salvar a New_Key no Secrets_Manager mas antes de revogar a chave antiga, THEN numa reexecução, WHEN o `id` da New_Key for diferente do Old_Key_ID no Parameter_Store, THE Rotation_Lambda SHALL retomar diretamente no passo de revogação usando o Old_Key_ID armazenado, sem gerar nova chave.
3. IF a Rotation_Lambda for reexecutada após o Old_Key_ID já ter sido revogado na Resend_API (DELETE retorna 404), THEN THE Rotation_Lambda SHALL tratar essa resposta como sucesso e encerrar sem erro.
4. THE Rotation_Lambda SHALL garantir que nenhuma chamada de revogação na Resend_API seja invocada antes de receber confirmação de escrita bem-sucedida do Secrets_Manager (VersionId não nulo).

---

### Requirement 10: Configurabilidade do Módulo Terraform

**User Story:** Como consumidor do módulo, quero configurar o módulo via variáveis Terraform bem documentadas, para que seja possível reutilizá-lo em diferentes ambientes e contas AWS sem modificar o código-fonte.

#### Acceptance Criteria

1. THE Terraform_Module SHALL expor como variáveis obrigatórias: `secret_arn` (ARN do segredo no Secrets Manager), `parameter_arn` (ARN do parâmetro no Parameter Store) e `rotation_schedule` (expressão cron do EventBridge), onde `rotation_schedule` deve ser validada por um bloco `validation` com regex `^(rate|cron)\\(` que rejeite qualquer outro formato.
2. THE Terraform_Module SHALL expor as seguintes variáveis opcionais com valores padrão: `function_name` (padrão `"nexuskey-rotation"`, máximo 64 caracteres), `log_retention_days` (padrão `30`, restrito ao conjunto de valores aceitos pelo CloudWatch Logs via bloco `validation`) e `tags` (mapa de strings, padrão `{}`).
3. THE Terraform_Module SHALL incluir um arquivo `terraform.tfvars.example` no diretório `examples/basic/` com valores de exemplo sintaticamente válidos para todas as variáveis obrigatórias e opcionais, de forma que o arquivo passe em `terraform validate` quando usado com o módulo.
4. THE Terraform_Module SHALL incluir atributos `description` em todas as variáveis e outputs definidos em `variables.tf` e `outputs.tf`.
