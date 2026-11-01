##############################################################################
# Data sources — usados para construir ARNs exatos nas políticas inline
##############################################################################

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

##############################################################################
# IAM Role — permite que o serviço Lambda assuma esta role
##############################################################################

resource "aws_iam_role" "this" {
  name        = "${var.function_name}-role"
  description = "Role IAM de execução da Lambda de rotação NexusKey (${var.function_name})"

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

##############################################################################
# Política inline — Secrets Manager (GetSecretValue + PutSecretValue)
##############################################################################

resource "aws_iam_role_policy" "secrets_manager" {
  name = "${var.function_name}-secrets-manager"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSecretsManagerAccess"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue"
        ]
        Resource = [var.secret_arn]
      }
    ]
  })
}

##############################################################################
# Política inline — SSM Parameter Store (GetParameter + PutParameter)
##############################################################################

resource "aws_iam_role_policy" "ssm_parameter" {
  name = "${var.function_name}-ssm-parameter"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSSMParameterAccess"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:PutParameter"
        ]
        Resource = [var.parameter_arn]
      }
    ]
  })
}

##############################################################################
# Política inline — CloudWatch Logs (CreateLogGroup + CreateLogStream + PutLogEvents)
##############################################################################

resource "aws_iam_role_policy" "cloudwatch_logs" {
  name = "${var.function_name}-cloudwatch-logs"
  role = aws_iam_role.this.id

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
          "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.function_name}:*"
        ]
      }
    ]
  })
}
