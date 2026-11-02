resource "aws_lambda_permission" "secrets_manager" {
  count = local.rotation_count

  statement_id  = "AllowExecutionFromSecretsManager"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this[0].function_name
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = aws_secretsmanager_secret.this.arn
}

# rotate_immediately = false: a primeira rotação ocorre na agenda ou por comando.
# A AWS testa a configuração ao ativar, então o valor inicial precisa existir antes.
resource "aws_secretsmanager_secret_rotation" "this" {
  count = local.rotation_count

  secret_id           = aws_secretsmanager_secret.this.id
  rotation_lambda_arn = aws_lambda_function.this[0].arn
  rotate_immediately  = false

  rotation_rules {
    schedule_expression = var.rotation_schedule
  }

  depends_on = [
    aws_lambda_permission.secrets_manager,
    aws_secretsmanager_secret_version.initial,
  ]
}
