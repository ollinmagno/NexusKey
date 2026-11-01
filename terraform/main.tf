# -----------------------------------------------------------------------------
# Secrets Manager — armazena o token da chave de API ativa.
# Nenhum aws_secretsmanager_secret_version e declarado: o valor inicial
# e configurado fora do Terraform para que o token nunca transite pelo state.
# -----------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "this" {
  name = "${var.function_name}-api-key"

  tags = var.tags
}

# -----------------------------------------------------------------------------
# SSM Parameter Store — metadados nao-sensiveis da rotacao (IDs das chaves).
# Tipo String (nao SecureString) pois apenas IDs sao armazenados.
# -----------------------------------------------------------------------------
resource "aws_ssm_parameter" "this" {
  name        = "/${var.function_name}/rotation-metadata"
  description = "Metadados de rotacao nao-sensiveis para ${var.function_name}"
  type        = "String"
  value       = "{}"
  overwrite   = true

  tags = var.tags
}

# -----------------------------------------------------------------------------
# CloudWatch Logs — grupo de logs da funcao Lambda com retencao configuravel.
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days

  tags = var.tags
}
