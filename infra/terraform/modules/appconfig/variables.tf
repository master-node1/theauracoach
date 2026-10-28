variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "environments" {
  description = "App environments in this account."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "KMS key for hosted configuration data."
  type        = string
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
