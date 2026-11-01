variable "secret_arn" {
  description = "ARN do segredo no AWS Secrets Manager onde o token da chave de API ativa é armazenado."
  type        = string
}

variable "parameter_arn" {
  description = "ARN do parâmetro no AWS Systems Manager Parameter Store onde os metadados de rotação são registrados."
  type        = string
}

variable "rotation_schedule" {
  description = "Expressão rate() ou cron() do Amazon EventBridge que aciona a rotação."
  type        = string
}

variable "function_name" {
  description = "Nome da função AWS Lambda responsável pelo ciclo de rotação."
  type        = string
  default     = "nexuskey-rotation"
}

variable "log_retention_days" {
  description = "Período de retenção dos logs no CloudWatch Logs, em dias."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Mapa de tags a aplicar em todos os recursos provisionados pelo módulo."
  type        = map(string)
  default     = {}
}
