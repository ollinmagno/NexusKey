# Exemplo: uma instância do módulo NexusKey por serviço.
# Copie terraform.tfvars.example para terraform.tfvars e ajuste os valores.
# O valor inicial do segredo nunca vai em arquivo: use TF_VAR_initial_secret.

module "nexuskey" {
  source = "../.."

  service_name           = var.service_name
  enable_rotation        = var.enable_rotation
  rotation_schedule      = var.rotation_schedule
  initial_secret         = var.initial_secret
  initial_secret_version = var.initial_secret_version
  log_retention_days     = var.log_retention_days
  tags                   = var.tags
}

output "secret_name" {
  description = "Nome do segredo no Secrets Manager."
  value       = module.nexuskey.secret_name
}

output "reader_policy_arn" {
  description = "ARN da política de leitura, para anexar à identidade da aplicação."
  value       = module.nexuskey.reader_policy_arn
}

output "lambda_function_name" {
  description = "Nome da Lambda de rotação, ou null sem rotação."
  value       = module.nexuskey.lambda_function_name
}

output "log_group_name" {
  description = "Nome do grupo de logs da Lambda de rotação, ou null sem rotação."
  value       = module.nexuskey.log_group_name
}

output "rotate_command" {
  description = "Comando que inicia uma rotação imediata, ou null sem rotação."
  value       = module.nexuskey.rotate_command
}
