variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "environment_label" {
  description = "Value of the node's auracoach.io/environment label (prod or nonprod)."
  type        = string
}

variable "account_id" {
  description = "AWS account ID, for Secrets Manager ARNs."
  type        = string
}

variable "vpc_id" {
  description = "VPC of the node."
  type        = string
}

variable "vpc_cidr_block" {
  description = "VPC CIDR, for DNS and data-store egress rules."
  type        = string
}

variable "subnet_id" {
  description = "Public subnet for the node."
  type        = string
}

variable "instance_type" {
  description = "Graviton instance type (ADR-007: t4g.xlarge prod, t4g.large non-prod)."
  type        = string
}

variable "root_volume_gb" {
  description = "Root gp3 volume size."
  type        = number
  default     = 50
}

variable "k3s_version" {
  description = "Pinned k3s release, upgraded later by system-upgrade-controller."
  type        = string
  default     = "v1.31.6+k3s1"
}

variable "ecr_credential_provider_version" {
  description = "cloud-provider-aws release that ships ecr-credential-provider."
  type        = string
  default     = "v1.31.0"
}

variable "kms_key_arn" {
  description = "KMS key for the root volume and secrets."
  type        = string
}

variable "etcd_snapshot_bucket_name" {
  description = "S3 bucket for etcd snapshots."
  type        = string
}

variable "etcd_snapshot_bucket_arn" {
  description = "ARN of the etcd snapshot bucket."
  type        = string
}

variable "etcd_snapshot_retention_days" {
  description = "Days of 6-hourly etcd snapshots to keep (14 prod, 3 non-prod)."
  type        = number
}

variable "secret_name_prefixes" {
  description = "Secrets Manager name prefixes the node may read, e.g. [\"auracoach/prod/\"]."
  type        = list(string)
}

variable "ecr_repository_arns" {
  description = "ECR repositories the node may pull from."
  type        = list(string)
}

variable "app_bucket_arns" {
  description = "Application buckets services read and write (user-private, content-media)."
  type        = list(string)
  default     = []
}

variable "ses_identity_arn" {
  description = "SES domain identity notification-service sends from; null to deny SES."
  type        = string
  default     = null
}

variable "ses_configuration_set_arn" {
  description = "SES configuration set ARN (required with ses_identity_arn)."
  type        = string
  default     = null
}

variable "cognito_user_pool_arns" {
  description = "User pools profile-service administers; empty to deny."
  type        = list(string)
  default     = []
}

variable "appconfig_application_arn" {
  description = "AppConfig application holding feature flags; null to deny."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Hosted zone cert-manager may write DNS-01 records to; null to deny."
  type        = string
  default     = null
}

variable "alarm_topic_arn" {
  description = "SNS topic for node alarms; empty string for none."
  type        = string
  default     = ""
}

variable "office_hours_schedule" {
  description = "Stop the node outside weekdays 08:00-20:00 IST (non-prod)."
  type        = bool
  default     = false
}

variable "termination_protection" {
  description = "Protect the instance from API termination."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
