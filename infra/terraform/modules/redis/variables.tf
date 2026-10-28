variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "secret_prefix" {
  description = "Secrets Manager prefix the node may read, e.g. auracoach/prod/."
  type        = string
}

variable "vpc_id" {
  description = "VPC of the cache."
  type        = string
}

variable "subnet_ids" {
  description = "Isolated subnets for the subnet group."
  type        = list(string)
}

variable "client_security_group_id" {
  description = "Security group allowed to connect (the k3s node)."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for data at rest and the AUTH secret."
  type        = string
}

variable "node_type" {
  description = "Node type (ADR-007: cache.t4g.micro)."
  type        = string
  default     = "cache.t4g.micro"
}

variable "alarm_topic_arn" {
  description = "SNS topic for alarms; empty string for none."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
