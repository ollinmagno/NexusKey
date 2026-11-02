variable "aws_region" {
  description = "Região AWS onde os recursos são criados."
  type        = string
}

variable "service_name" {
  description = "Nome do serviço externo, em kebab-case."
  type        = string
}

variable "enable_rotation" {
  description = "Cria a Lambda e o agendamento nativo de rotação."
  type        = bool
  default     = false
}

variable "rotation_schedule" {
  description = "Expressão rate() ou cron() aceita pelo Secrets Manager."
  type        = string
  default     = null
}

variable "initial_secret" {
  description = "JSON inicial do segredo. Informe por TF_VAR_initial_secret, nunca em arquivo."
  type        = string
  ephemeral   = true
  sensitive   = true
  default     = null
}

variable "initial_secret_version" {
  description = "0 não grava o valor inicial; um número maior grava 'initial_secret'."
  type        = number
  default     = 0
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
