# Requirements Document

## Introduction

O **NexusKey** é um módulo Terraform que provisiona na AWS o segredo de um serviço externo e, quando esse serviço permite, a rotação automatizada da credencial, usando a rotação nativa do Secrets Manager. O operador executa o módulo em sua máquina apenas para provisionar. Depois disso, a rotação ocorre na AWS, sem depender dessa máquina.

Esta spec define o núcleo, independente de serviço: agendamento, etapas da rotação, infraestrutura e segurança. Cada serviço tem spec própria, um Service_Adapter e uma instância do módulo, com um único segredo em JSON. O primeiro serviço é definido na spec `resend-api-key`.

O NexusKey é responsável por provisionar o segredo e rotacionar a credencial; a SaaS_Application, que roda na mesma conta AWS, apenas lê o valor atual. Nenhum valor de credencial fica no Terraform state.

## Glossary

- **External_Service**: Serviço fora da AWS cuja credencial é armazenada no Service_Secret.
- **Rotation_Lambda**: Função AWS Lambda (Node.js 24.x) que executa as etapas da rotação.
- **Rotation_Event**: Evento enviado pelo Secrets_Manager à Rotation_Lambda, com os campos `Step`, `SecretId` e `ClientRequestToken`.
- **Rotation_Schedule**: Regra de rotação nativa do Secrets_Manager, que define quando a rotação ocorre.
- **Secrets_Manager**: Serviço AWS Secrets Manager, que armazena o Service_Secret e controla suas versões e rótulos.
- **Service_Secret**: Segredo único de um serviço, cujo valor é um objeto JSON com os campos definidos pelo Service_Adapter ou, em serviço sem rotação, pelo operador.
- **Service_Adapter**: Módulo JavaScript com as operações e os schemas específicos de um External_Service.
- **Current_Credential**: Credencial contida na versão `AWSCURRENT` do Service_Secret.
- **New_Credential**: Credencial gerada na rotação e contida na versão `AWSPENDING` do Service_Secret.
- **Previous_Credential**: Credencial contida na versão `AWSPREVIOUS` do Service_Secret.
- **Zod_Schema**: Schema de validação definido com a biblioteca Zod.
- **IAM_Role**: Role AWS IAM atribuída à Rotation_Lambda, com permissões de privilégio mínimo restritas a ARNs exatos.
- **Terraform_Module**: Módulo Terraform deste repositório.
- **Lambda_Package**: Arquivo `.zip` da Rotation_Lambda gerado pelo Terraform_Module.
- **README**: Arquivo `README.md` na raiz do repositório.
- **SaaS_Application**: Aplicação Node.js do operador, executada na mesma conta AWS, que consome a credencial contida no Service_Secret.
- **Reader_Policy**: Política IAM gerenciada, criada pelo Terraform_Module, que dá acesso de leitura ao Service_Secret.

## Requirements

### Requirement 1: Agendamento pela Rotação Nativa

**User Story:** Como operador de infraestrutura, quero que a rotação seja agendada pelo próprio Secrets Manager, para não depender de outros serviços nem de processo manual.

#### Acceptance Criteria

1. WHEN a variável `enable_rotation` for `true`, THE Rotation_Schedule SHALL usar como `schedule_expression` o valor exato da variável `rotation_schedule`.
2. WHEN o Secrets_Manager invoca a Rotation_Lambda com um Rotation_Event, THE Rotation_Lambda SHALL executar a etapa indicada em `Step` e retornar dentro de 300 segundos.
3. IF a variável `rotation_schedule` for informada e não começar com `rate(` ou `cron(`, THEN THE Terraform_Module SHALL falhar durante o `terraform validate` com uma mensagem de erro que identifica o nome da variável e o valor rejeitado.
4. IF o `Step` do Rotation_Event não corresponder a uma das quatro etapas, THEN THE Rotation_Lambda SHALL encerrar com erro, sem efeito colateral.
5. THE Rotation_Lambda SHALL aceitar os valores de `Step` tanto em `camelCase` (`createSecret`) quanto em `snake_case` (`create_secret`), pois a documentação da AWS traz as duas formas.

---

### Requirement 2: Criação da Nova Credencial

**User Story:** Como operador de infraestrutura, quero que a nova credencial fique em uma versão pendente até ser testada, para que as aplicações só a recebam depois de confirmada.

#### Acceptance Criteria

1. WHEN o `Step` é `createSecret` e não existe versão `AWSPENDING` para o `ClientRequestToken`, THE Rotation_Lambda SHALL solicitar a New_Credential ao Service_Adapter, informando o valor validado da Current_Credential.
2. IF o Service_Adapter falhar ao criar a New_Credential, THEN THE Rotation_Lambda SHALL encerrar com erro, sem gravar no Secrets_Manager e sem novas tentativas dentro da mesma invocação.
3. WHEN o Service_Adapter retorna a New_Credential, THE Rotation_Lambda SHALL chamar `PutSecretValue` no Service_Secret com o `ClientRequestToken` do Rotation_Event, o rótulo `AWSPENDING` e o valor validado pelo Zod_Schema do Service_Adapter.
4. WHEN a chamada `PutSecretValue` retorna, THE Rotation_Lambda SHALL verificar que a resposta contém um `VersionId` não nulo antes de concluir a etapa.
5. IF a chamada `PutSecretValue` retornar erro, THEN THE Rotation_Lambda SHALL encerrar com erro, mantendo a versão `AWSCURRENT` sem alteração.

---

### Requirement 3: Validação de Dados

**User Story:** Como engenheiro de segurança, quero que os dados usados na rotação sejam validados com Zod antes de qualquer escrita na AWS, para evitar persistência de dados malformados ou inesperados.

#### Acceptance Criteria

1. THE Rotation_Lambda SHALL validar com o Zod_Schema do Service_Adapter todo valor do Service_Secret lido do Secrets_Manager antes de utilizá-lo.
2. THE Service_Adapter SHALL validar com Zod toda resposta do External_Service antes de retorná-la à Rotation_Lambda.
3. WHEN um dado não satisfizer o Zod_Schema correspondente, THE Rotation_Lambda SHALL registrar um log contendo apenas o nome do campo inválido e o código do erro, sem incluir o payload nem o valor de nenhuma credencial.

---

### Requirement 4: Teste e Promoção da Nova Versão

**User Story:** Como operador de infraestrutura, quero que a nova credencial seja testada antes de virar a versão atual, para que uma credencial inválida nunca chegue às aplicações.

#### Acceptance Criteria

1. WHEN o `Step` é `setSecret`, THE Rotation_Lambda SHALL executar a operação correspondente do Service_Adapter ou, se ela não existir, concluir a etapa sem efeito colateral.
2. WHEN o `Step` é `testSecret`, THE Rotation_Lambda SHALL executar a operação de teste do Service_Adapter com o valor da versão `AWSPENDING`.
3. IF o teste falhar, THEN THE Rotation_Lambda SHALL encerrar com erro, mantendo a versão `AWSCURRENT` sem alteração.
4. WHEN o `Step` é `finishSecret` e a versão do `ClientRequestToken` não é `AWSCURRENT`, THE Rotation_Lambda SHALL mover o rótulo `AWSCURRENT` para essa versão com `UpdateSecretVersionStage`.

---

### Requirement 5: Revogação da Credencial Anterior

**User Story:** Como engenheiro de segurança, quero que a credencial anterior seja revogada somente depois da promoção da nova, e que uma falha nessa etapa fique visível, para não deixar credenciais antigas ativas sem que isso apareça como falha.

#### Acceptance Criteria

1. WHEN o rótulo `AWSCURRENT` está na versão do `ClientRequestToken` durante `finishSecret`, existe versão `AWSPREVIOUS` e o Service_Adapter define a operação de revogação, THE Rotation_Lambda SHALL revogar a Previous_Credential por meio dessa operação.
2. IF o Service_Adapter informar que a Previous_Credential já estava revogada, THEN THE Rotation_Lambda SHALL concluir a etapa com sucesso.
3. IF a revogação falhar por outro motivo, THEN THE Rotation_Lambda SHALL encerrar com erro, sem reverter o rótulo `AWSCURRENT`.
4. WHEN o `Step` é `createSecret`, não existe versão `AWSPENDING` para o `ClientRequestToken`, existe versão `AWSPREVIOUS` e o Service_Adapter define a operação de revogação, THE Rotation_Lambda SHALL revogar a Previous_Credential antes de criar a New_Credential, aplicando os critérios 5.2 e 5.3, para que uma revogação anterior que falhou não se perca quando o rótulo `AWSPREVIOUS` mudar.
5. IF o Service_Adapter não definir a operação de revogação, THEN THE Rotation_Lambda SHALL concluir sem tentar revogar.

---

### Requirement 6: Segurança e Não Exposição de Credenciais

**User Story:** Como engenheiro de segurança, quero que nenhum valor de credencial apareça em logs, no Terraform state ou em outputs, para que credenciais sensíveis não sejam expostas acidentalmente.

#### Acceptance Criteria

1. THE Rotation_Lambda SHALL omitir de todas as mensagens de log os valores de credenciais, o valor do Service_Secret e os payloads brutos do External_Service.
2. THE Terraform_Module SHALL gravar o valor inicial do Service_Secret somente por variável `ephemeral` e argumento write-only (`secret_string_wo`), mantendo todo valor de credencial fora do Terraform state e do plan.
3. THE Terraform_Module SHALL marcar com `sensitive = true` todo output que contenha ou derive de um ARN de segredo do Secrets_Manager.
4. IF uma exceção ocorrer na Rotation_Lambda, THEN THE Rotation_Lambda SHALL registrar apenas o nome da classe do erro e o nome da etapa, excluindo stack traces, objetos de resposta e propriedades que possam conter valores de credenciais.

---

### Requirement 7: IAM com Privilégio Mínimo

**User Story:** Como engenheiro de segurança, quero que a IAM Role da Lambda tenha permissões restritas a ARNs exatos, para minimizar o raio de impacto de um eventual comprometimento.

#### Acceptance Criteria

1. THE IAM_Role SHALL conceder à Rotation_Lambda somente `secretsmanager:DescribeSecret`, `secretsmanager:GetSecretValue`, `secretsmanager:PutSecretValue` e `secretsmanager:UpdateSecretVersionStage`, restritas ao ARN exato do Service_Secret criado pelo Terraform_Module.
2. THE IAM_Role SHALL conceder à Rotation_Lambda somente `logs:CreateLogGroup`, `logs:CreateLogStream` e `logs:PutLogEvents`, restritas ao ARN do grupo de logs da própria função, no formato `arn:aws:logs:<region>:<account_id>:log-group:/aws/lambda/<function_name>:*`.
3. THE IAM_Role não SHALL conter wildcards (`*`) em elementos `Resource`, exceto o sufixo `:*` exigido pelo critério 7.2.
4. THE IAM_Role SHALL conter exatamente duas políticas inline, uma para Secrets Manager e uma para CloudWatch Logs, sem nenhuma política adicional anexada.
5. THE Terraform_Module SHALL permitir a invocação da Rotation_Lambda apenas ao principal `secretsmanager.amazonaws.com`, com `source_arn` igual ao ARN do Service_Secret.

---

### Requirement 8: Idempotência do Ciclo de Rotação

**User Story:** Como operador de infraestrutura, quero que reexecuções das etapas não dupliquem credenciais nem causem estados inconsistentes, pois o Secrets Manager repete a rotação quando há falha.

#### Acceptance Criteria

1. WHEN o `Step` é `createSecret` e já existe versão `AWSPENDING` para o `ClientRequestToken`, THE Rotation_Lambda SHALL concluir a etapa sem chamar o External_Service e sem gravar no Secrets_Manager.
2. IF o Service_Secret estiver com a rotação desativada ou não possuir versão para o `ClientRequestToken`, THEN THE Rotation_Lambda SHALL encerrar com erro, sem efeito colateral.
3. WHEN a versão do `ClientRequestToken` já é `AWSCURRENT`, THE Rotation_Lambda SHALL concluir sem efeito colateral as etapas `createSecret`, `setSecret` e `testSecret`.
4. WHEN o `Step` é `finishSecret` e a versão do `ClientRequestToken` já é `AWSCURRENT`, THE Rotation_Lambda SHALL pular a promoção e prosseguir para a revogação da Previous_Credential.
5. THE Rotation_Lambda SHALL garantir que nenhuma revogação feita durante `finishSecret` ocorra antes da confirmação de que o rótulo `AWSCURRENT` está na versão do `ClientRequestToken`.

---

### Requirement 9: Configurabilidade do Módulo Terraform

**User Story:** Como consumidor do módulo, quero configurar uma instância por serviço com variáveis bem documentadas, para reutilizá-lo sem modificar o código-fonte, inclusive em serviços que ainda são rotacionados manualmente.

#### Acceptance Criteria

1. THE Terraform_Module SHALL expor como variável obrigatória `service_name`, em kebab-case, e derivar dela o nome de todos os recursos, de forma que múltiplas instâncias não tenham conflito de nomes.
2. THE Terraform_Module SHALL expor as seguintes variáveis opcionais com valores padrão: `enable_rotation` (padrão `false`), `rotation_schedule` (padrão `null`), `initial_secret` (`ephemeral` e `sensitive`, padrão `null`), `initial_secret_version` (padrão `0`, que indica não gravar valor inicial pelo Terraform), `log_retention_days` (padrão `30`, restrito ao conjunto de valores aceitos pelo CloudWatch Logs via bloco `validation`) e `tags` (mapa de strings, padrão `{}`).
3. THE Terraform_Module SHALL criar o Service_Secret e a Reader_Policy em toda instância, sem receber ARNs desses recursos por variável.
4. WHILE a variável `enable_rotation` for `false`, THE Terraform_Module não SHALL criar a Rotation_Lambda, a IAM_Role, o grupo de logs, a permissão de invocação nem o Rotation_Schedule, permitindo centralizar um serviço ainda rotacionado manualmente.
5. IF `enable_rotation` for `true` e `rotation_schedule` for nulo, ou `service_name` não tiver Service_Adapter, THEN THE Terraform_Module SHALL falhar durante o `terraform plan` com uma mensagem de erro que identifica a variável, pois validações entre variáveis não são avaliadas pelo `terraform validate`.
6. THE Terraform_Module SHALL incluir em `examples/basic/` uma configuração raiz com a região como variável e um arquivo `terraform.tfvars.example` com valores de exemplo sintaticamente válidos para as variáveis não efêmeras, de forma que o exemplo passe em `terraform validate`.
7. THE Terraform_Module SHALL incluir atributos `description` em todas as variáveis e outputs definidos em `variables.tf` e `outputs.tf`.
8. THE Lambda_Package SHALL conter as dependências de execução e não SHALL conter os arquivos de teste, e o README SHALL indicar a execução de `npm ci --omit=dev` antes do `terraform apply`.

---

### Requirement 10: Configuração Inicial

**User Story:** Como operador de infraestrutura, quero informar a credencial existente ao provisionar e depois disparar a rotação por um comando, sem expor o valor no state.

#### Acceptance Criteria

1. WHEN a variável `enable_rotation` for `true`, THE Terraform_Module SHALL criar o Rotation_Schedule com `rotate_immediately = false`, somente depois da gravação do valor inicial, pois o Secrets_Manager testa a configuração ao ativar a rotação.
2. IF a versão `AWSCURRENT` do Service_Secret estiver ausente ou não satisfizer o Zod_Schema do Service_Adapter, THEN THE Rotation_Lambda SHALL encerrar com erro, sem chamar o External_Service e sem gravar no Secrets_Manager.
3. WHEN `terraform apply` é executado depois de uma rotação sem alterar `initial_secret_version`, THE Terraform_Module não SHALL regravar o valor inicial nem mover o rótulo `AWSCURRENT`.
4. WHEN a variável `enable_rotation` for `true`, THE Terraform_Module SHALL expor como output o comando `aws secretsmanager rotate-secret` do Service_Secret.
5. THE README SHALL descrever a sequência: informar o JSON inicial em `TF_VAR_initial_secret` no primeiro `terraform apply`, fazer a SaaS_Application ler o Service_Secret, aplicar com `enable_rotation = true` e rotacionar com `aws secretsmanager rotate-secret`.
6. THE README SHALL alertar que a SaaS_Application deve ler a credencial do Service_Secret antes de `enable_rotation = true`, pois a primeira rotação pode revogar a credencial inicial.
7. THE README SHALL descrever como recuperar uma rotação que falhou com versão `AWSPENDING` remanescente, incluindo a revogação manual da credencial que ela contém.
8. THE README SHALL descrever a execução na máquina do operador: credenciais AWS necessárias, diretório de execução, ferramentas exigidas e cuidados com o Terraform state local.

---

### Requirement 11: Consumo pela SaaS Application

**User Story:** Como desenvolvedor da SaaS Application, quero ler a credencial atual com permissão mínima e sobreviver à rotação, para que a troca de credenciais não interrompa o serviço.

#### Acceptance Criteria

1. THE Reader_Policy SHALL conceder somente `secretsmanager:GetSecretValue` no ARN exato do Service_Secret.
2. THE Terraform_Module SHALL expor como outputs o ARN da Reader_Policy e o nome e o ARN do Service_Secret.
3. THE Terraform_Module não SHALL anexar a Reader_Policy à identidade da SaaS_Application, pois ela é gerenciada pelo projeto da aplicação.
4. THE README SHALL mostrar como a SaaS_Application lê o Service_Secret em Node.js, sem credenciais fixas.
5. THE README SHALL orientar a SaaS_Application a manter a credencial em cache por no máximo 5 minutos e a ler o Service_Secret novamente ao receber um erro de autenticação do External_Service.

---

### Requirement 12: Contrato para Novos Serviços

**User Story:** Como operador de infraestrutura, quero adicionar outros serviços externos depois, sem reescrever o fluxo de rotação, pois o NexusKey não é especializado em um único serviço.

#### Acceptance Criteria

1. THE Rotation_Lambda SHALL isolar em um Service_Adapter toda chamada e validação específica do External_Service, mantendo as etapas da rotação independentes do serviço.
2. THE Service_Adapter SHALL definir o Zod_Schema do Service_Secret e as operações de criar e testar a credencial.
3. THE Service_Adapter MAY definir as operações de aplicar a credencial no serviço e de revogar a anterior, pois nem todo serviço precisa delas.
4. THE Rotation_Lambda SHALL selecionar o Service_Adapter a partir de `service_name`.
5. IF `service_name` não corresponder a um Service_Adapter disponível, THEN THE Rotation_Lambda SHALL encerrar com erro, sem efeito colateral.
6. THE Rotation_Lambda não SHALL assumir que a Current_Credential é a que autoriza a rotação, nem que a Previous_Credential é revogada imediatamente.
7. THE README SHALL listar o que é preciso para adicionar um serviço, incluindo uma API que permita criar ou rotacionar credenciais.
