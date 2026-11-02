locals {
  # Cada spec de serviço acrescenta aqui o nome do seu adaptador.
  rotation_adapters = ["resend"]
}

variable "service_name" {
  description = "Nome do serviço externo, em kebab-case. Dele derivam os nomes de todos os recursos, então cada instância do módulo precisa de um nome próprio."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", var.service_name)) && length(var.service_name) <= 46
    error_message = "A variável 'service_name' deve estar em kebab-case e ter no máximo 46 caracteres."
  }
}

variable "enable_rotation" {
  description = "Cria a Lambda e o agendamento nativo de rotação. Com false, a instância cria só o segredo e a política de leitura."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_rotation || var.rotation_schedule != null
    error_message = "A variável 'rotation_schedule' é obrigatória quando 'enable_rotation' é true."
  }

  validation {
    condition     = !var.enable_rotation || contains(local.rotation_adapters, var.service_name)
    error_message = "A variável 'service_name' não tem adaptador de rotação; use 'enable_rotation = false' ou adicione o adaptador."
  }
}

variable "rotation_schedule" {
  description = "Expressão rate() ou cron() aceita pelo Secrets Manager, por exemplo \"rate(30 days)\". Obrigatória quando 'enable_rotation' é true."
  type        = string
  default     = null

  validation {
    condition     = var.rotation_schedule == null || can(regex("^(rate|cron)\\(", var.rotation_schedule))
    error_message = "A variável 'rotation_schedule' recebeu o valor \"${coalesce(var.rotation_schedule, "null")}\", que não é uma expressão válida. Use rate(<valor> <unidade>) ou cron(<expressão>)."
  }
}

variable "initial_secret" {
  description = "JSON inicial do segredo. É efêmero: não fica no state nem no plan. Informe por TF_VAR_initial_secret, nunca em arquivo *.tfvars."
  type        = string
  ephemeral   = true
  sensitive   = true
  default     = null
}

variable "initial_secret_version" {
  description = "Controla a gravação do valor inicial pelo Terraform: 0 não grava; um número maior grava 'initial_secret'. Não altere depois de uma rotação, pois isso regravaria um valor antigo."
  type        = number
  default     = 0

  validation {
    condition     = var.initial_secret_version >= 0 && floor(var.initial_secret_version) == var.initial_secret_version
    error_message = "A variável 'initial_secret_version' deve ser um inteiro maior ou igual a 0."
  }
}

variable "log_retention_days" {
  description = "Período de retenção dos logs no CloudWatch Logs, em dias. Deve ser um dos valores aceitos pelo serviço: 0 (nunca expirar), 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288 ou 3653."
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
