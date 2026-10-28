variable "name_prefix" {
  description = "Prefix for bucket names, e.g. auracoach-prod. The account ID is appended for uniqueness."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for SSE-KMS buckets."
  type        = string
}

variable "etcd_snapshot_retention_days" {
  description = "Days of etcd snapshots kept by k3s; the lifecycle rule is a backstop two days later."
  type        = number
}

variable "log_retention_days" {
  description = "Days to keep S3 access logs."
  type        = number
  default     = 90
}

variable "enable_replication" {
  description = "Replicate user-private to the DR region (prod)."
  type        = bool
  default     = false
}

variable "cloudfront_distribution_arn" {
  description = "Distribution allowed to read content-media through origin access control; null for none."
  type        = string
  default     = null
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
