# Example: Basic NexusKey usage
# This example shows how to use the NexusKey module to provision
# automated Resend API key rotation infrastructure.
#
# Copy terraform.tfvars.example to terraform.tfvars and fill in your values.

module "nexuskey" {
  source = "../.."

  # Required variables
  secret_arn        = var.secret_arn
  parameter_arn     = var.parameter_arn
  rotation_schedule = var.rotation_schedule

  # Optional variables (showing defaults)
  function_name      = var.function_name
  log_retention_days = var.log_retention_days
  tags               = var.tags
}

output "lambda_function_arn" {
  description = "ARN da Lambda Function de rotação."
  value       = module.nexuskey.lambda_function_arn
}

output "lambda_function_name" {
  description = "Nome da Lambda Function de rotação."
  value       = module.nexuskey.lambda_function_name
}

output "log_group_name" {
  description = "Nome do grupo de logs CloudWatch."
  value       = module.nexuskey.log_group_name
}
