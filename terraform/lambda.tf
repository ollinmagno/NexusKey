data "archive_file" "rotation" {
  count = local.rotation_count

  type        = "zip"
  source_dir  = "${path.module}/lambda/rotation"
  output_path = "${path.module}/lambda_${var.service_name}.zip"
  excludes = [
    "adapters/resend.test.mjs",
    "package-lock.json",
    "rotation.test.mjs",
    "test-support/fake-secrets-manager.mjs",
  ]
}

resource "aws_cloudwatch_log_group" "this" {
  count = local.rotation_count

  name              = local.log_group_name
  retention_in_days = var.log_retention_days

  tags = var.tags
}

resource "aws_lambda_function" "this" {
  count = local.rotation_count

  function_name    = local.function_name
  filename         = data.archive_file.rotation[0].output_path
  source_code_hash = data.archive_file.rotation[0].output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 300
  role             = aws_iam_role.this[0].arn

  environment {
    variables = {
      SERVICE_NAME = var.service_name
    }
  }

  logging_config {
    log_format = "JSON"
  }

  depends_on = [aws_cloudwatch_log_group.this]

  tags = var.tags
}
