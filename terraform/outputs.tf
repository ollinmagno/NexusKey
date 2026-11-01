output "lambda_function_arn" {
  description = "ARN da Lambda Function de rotação de chaves."
  value       = aws_lambda_function.this.arn
  sensitive   = false
}

output "lambda_function_name" {
  description = "Nome da Lambda Function de rotação de chaves."
  value       = aws_lambda_function.this.function_name
  sensitive   = false
}

output "secret_arn" {
  description = "ARN do segredo no Secrets Manager onde a chave de API é armazenada."
  value       = aws_secretsmanager_secret.this.arn
  sensitive   = true
}

output "log_group_name" {
  description = "Nome do grupo de logs CloudWatch associado à Lambda Function."
  value       = aws_cloudwatch_log_group.this.name
  sensitive   = false
}
