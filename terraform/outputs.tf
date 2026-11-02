output "secret_name" {
  description = "Nome do segredo no Secrets Manager."
  value       = aws_secretsmanager_secret.this.name
}

output "secret_arn" {
  description = "ARN do segredo no Secrets Manager."
  value       = aws_secretsmanager_secret.this.arn
  sensitive   = true
}

output "reader_policy_arn" {
  description = "ARN da política de leitura, para anexar à identidade da aplicação."
  value       = aws_iam_policy.reader.arn
}

output "lambda_function_name" {
  description = "Nome da Lambda de rotação, ou null sem rotação."
  value       = one(aws_lambda_function.this[*].function_name)
}

output "lambda_function_arn" {
  description = "ARN da Lambda de rotação, ou null sem rotação."
  value       = one(aws_lambda_function.this[*].arn)
}

output "log_group_name" {
  description = "Nome do grupo de logs da Lambda de rotação, ou null sem rotação."
  value       = one(aws_cloudwatch_log_group.this[*].name)
}

output "rotate_command" {
  description = "Comando que inicia uma rotação imediata, ou null sem rotação."
  value       = var.enable_rotation ? "aws secretsmanager rotate-secret --secret-id ${aws_secretsmanager_secret.this.name}" : null
}
