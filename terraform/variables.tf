variable "secret_arn" {
  description = "ARN do segredo no AWS Secrets Manager onde o token da chave de API ativa é armazenado."
  type        = string

  validation {
    condition     = length(var.secret_arn) > 0
    error_message = "A variável 'secret_arn' não pode ser vazia."
  }
}

variable "parameter_arn" {
  description = "ARN do parâmetro no AWS Systems Manager Parameter Store onde os metadados de rotação (IDs das chaves) são registrados."
  type        = string

  validation {
    condition     = length(var.parameter_arn) > 0
    error_message = "A variável 'parameter_arn' não pode ser vazia."
  }
}

variable "rotation_schedule" {
  description = "Expressão de agendamento do Amazon EventBridge para acionar a rotação. Deve ser uma expressão rate() ou cron() válida (ex: \"rate(7 days)\" ou \"cron(0 3 ? * SUN *)\")."
  type        = string

  validation {
    condition     = can(regex("^(rate|cron)\\(", var.rotation_schedule))
    error_message = "A variável 'rotation_schedule' recebeu o valor \"${var.rotation_schedule}\", que não é uma expressão válida. Use o formato rate(<valor> <unidade>) ou cron(<expressão>)."
  }
}

variable "function_name" {
  description = "Nome da função AWS Lambda responsável pelo ciclo de rotação. Deve ter no máximo 64 caracteres."
  type        = string
  default     = "nexuskey-rotation"

  validation {
    condition     = length(var.function_name) <= 64
    error_message = "A variável 'function_name' não pode ter mais de 64 caracteres."
  }
}

variable "log_retention_days" {
  description = "Período de retenção dos logs no CloudWatch Logs em dias. Deve ser um dos valores aceitos pelo serviço: 0 (nunca expirar), 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288 ou 3653."
  type        = number
  default     = 30

  validation {
    condition = contains(
      [0, 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653],
      var.log_retention_days
    )
    error_message = "A variável 'log_retention_days' deve ser um dos valores aceitos pelo CloudWatch Logs: 0, 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288 ou 3653."
  }
}

variable "tags" {
  description = "Mapa de tags a aplicar em todos os recursos provisionados pelo módulo."
  type        = map(string)
  default     = {}
}
