locals {
  function_name  = "nexuskey-${var.service_name}-rotation"
  log_group_name = "/aws/lambda/${local.function_name}"
  rotation_count = var.enable_rotation ? 1 : 0
}

# -----------------------------------------------------------------------------
# Segredo único do serviço, com todos os seus dados em JSON.
# -----------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "this" {
  name = "nexuskey/${var.service_name}"

  tags = var.tags
}

# -----------------------------------------------------------------------------
# Valor inicial: variável efêmera em argumento write-only, fora do state e do plan.
# A rotação move os rótulos depois, por isso version_stages é ignorado.
# -----------------------------------------------------------------------------
resource "aws_secretsmanager_secret_version" "initial" {
  count = var.initial_secret_version > 0 ? 1 : 0

  secret_id                = aws_secretsmanager_secret.this.id
  secret_string_wo         = var.initial_secret
  secret_string_wo_version = var.initial_secret_version

  lifecycle {
    ignore_changes = [version_stages]
  }
}

# -----------------------------------------------------------------------------
# Política de leitura, anexada pelo projeto da aplicação à identidade dela.
# -----------------------------------------------------------------------------
resource "aws_iam_policy" "reader" {
  name        = "nexuskey-${var.service_name}-secret-read"
  description = "Leitura do segredo nexuskey/${var.service_name}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowReadSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.this.arn]
      }
    ]
  })

  tags = var.tags
}
