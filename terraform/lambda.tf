data "archive_file" "rotation" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/rotation"
  output_path = "${path.module}/lambda_rotation.zip"
}

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  filename         = data.archive_file.rotation.output_path
  source_code_hash = data.archive_file.rotation.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 300
  role             = aws_iam_role.this.arn

  environment {
    variables = {
      SECRET_ARN    = var.secret_arn
      PARAMETER_ARN = var.parameter_arn
    }
  }

  logging_config {
    log_format = "JSON"
  }

  depends_on = [aws_cloudwatch_log_group.this]

  tags = var.tags
}
