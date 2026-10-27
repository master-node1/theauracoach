variable "project" {
  description = "First path segment of secret names (auracoach)."
  type        = string
  default     = "auracoach"
}

variable "environments" {
  description = "Environments in this account, e.g. [\"dev\", \"staging\"]."
  type        = list(string)
}

variable "services" {
  description = "Deployables that need runtime secrets."
  type        = list(string)
}

variable "in_cluster_datastores" {
  description = "Create auracoach/<env>/datastores for the in-cluster Postgres and Redis (non-prod)."
  type        = bool
  default     = false
}

variable "cluster_label" {
  description = "prod or nonprod; the platform secret is auracoach/<cluster_label>/platform."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for secret encryption."
  type        = string
}

variable "recovery_window_days" {
  description = "Days a deleted secret can be restored."
  type        = number
  default     = 7
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
