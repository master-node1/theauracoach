variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "vpc_id" {
  description = "VPC of the database."
  type        = string
}

variable "subnet_ids" {
  description = "Isolated subnets (two AZs) for the subnet group."
  type        = list(string)
}

variable "client_security_group_id" {
  description = "Security group allowed to connect (the k3s node)."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for storage, Performance Insights and the master secret."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL major.minor version."
  type        = string
  default     = "16.6"
}

variable "instance_class" {
  description = "Instance class (ADR-007: db.t4g.small)."
  type        = string
  default     = "db.t4g.small"
}

variable "allocated_storage_gb" {
  description = "Initial gp3 storage."
  type        = number
  default     = 50
}

variable "max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling."
  type        = number
  default     = 200
}

variable "backup_retention_days" {
  description = "Automated backup and PITR window."
  type        = number
  default     = 14
}

variable "dr_copy_retention_days" {
  description = "Days to keep weekly snapshot copies in the DR region."
  type        = number
  default     = 35
}

variable "alarm_topic_arn" {
  description = "SNS topic for database alarms; empty string for none."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
