variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for the SNS topic."
  type        = string
}

variable "alert_emails" {
  description = "Addresses subscribed to alerts (each must confirm by email)."
  type        = list(string)
  default     = []
}

variable "monthly_budget_usd" {
  description = "Monthly AWS cost budget for this account, before AI provider spend."
  type        = number
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
