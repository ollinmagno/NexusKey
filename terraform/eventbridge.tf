resource "aws_cloudwatch_event_rule" "this" {
  name                = "${var.function_name}-rotation-schedule"
  description         = "Aciona a rotacao de chave NexusKey (${var.function_name})"
  schedule_expression = var.rotation_schedule
  state               = "ENABLED"

  tags = var.tags
}

resource "aws_cloudwatch_event_target" "this" {
  rule      = aws_cloudwatch_event_rule.this.name
  target_id = "${var.function_name}-target"
  arn       = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.this.arn
}
