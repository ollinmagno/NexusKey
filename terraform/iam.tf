data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "aws_iam_role" "this" {
  count = local.rotation_count

  name        = "${local.function_name}-role"
  description = "Role de execução da Lambda ${local.function_name}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowLambdaAssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "secrets_manager" {
  count = local.rotation_count

  name = "${local.function_name}-secrets-manager"
  role = aws_iam_role.this[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSecretRotation"
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage"
        ]
        Resource = [aws_secretsmanager_secret.this.arn]
      }
    ]
  })
}

resource "aws_iam_role_policy" "cloudwatch_logs" {
  count = local.rotation_count

  name = "${local.function_name}-cloudwatch-logs"
  role = aws_iam_role.this[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudWatchLogsAccess"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = [
          "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:${local.log_group_name}:*"
        ]
      }
    ]
  })
}
