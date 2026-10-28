variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "region" {
  description = "AWS region, used for the S3 gateway endpoint service name."
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR. The public subnet is the first /24, isolated subnets start at the eleventh."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key that encrypts the flow log group."
  type        = string
}

variable "flow_log_retention_days" {
  description = "Days to keep rejected-traffic flow logs."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
