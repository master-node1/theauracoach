variable "aws_account_id" {
  description = "The auracoach-prod account; the provider refuses any other."
  type        = string
}

variable "region" {
  description = "Primary region (ADR-007: Mumbai)."
  type        = string
  default     = "ap-south-1"
}

variable "dr_region" {
  description = "Region for snapshot copies and S3 replication."
  type        = string
  default     = "ap-southeast-1"
}

variable "domain_name" {
  description = "Apex of the Route 53 zone in this account, e.g. auracoach.example. Hosts: app., api., origin., mail."
  type        = string
}

variable "route53_zone_id" {
  description = "ID of the public hosted zone for domain_name (created by the owner, TAC-44)."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR."
  type        = string
  default     = "10.20.0.0/16"
}

variable "node_instance_type" {
  description = "k3s node size (ADR-007 Stage 1)."
  type        = string
  default     = "t4g.xlarge"
}

variable "alert_emails" {
  description = "Who receives alarms and budget alerts."
  type        = list(string)
  default     = []
}

variable "monthly_budget_usd" {
  description = "AWS budget for this account (ADR-007 prod ≈ $185; alert headroom included)."
  type        = number
  default     = 220
}

variable "dmarc_report_email" {
  description = "DMARC aggregate report address."
  type        = string
  default     = ""
}

variable "google_client_id" {
  description = "Google OAuth client ID; empty disables Google sign-in."
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth client secret (pass as TF_VAR_google_client_secret)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "apple_services_id" {
  description = "Apple Services ID; empty disables Sign in with Apple."
  type        = string
  default     = ""
}

variable "apple_team_id" {
  description = "Apple team ID."
  type        = string
  default     = ""
}

variable "apple_key_id" {
  description = "Apple key ID."
  type        = string
  default     = ""
}

variable "apple_private_key" {
  description = "Apple private key PEM (pass as TF_VAR_apple_private_key)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "geo_allow_countries" {
  description = "Countries CloudFront serves; empty for all (India-first beta could use [\"IN\"])."
  type        = list(string)
  default     = []
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub OIDC provider (false if the account already has one)."
  type        = bool
  default     = true
}

variable "state_bucket" {
  description = "State bucket from the bootstrap stack (for the CI roles)."
  type        = string
}

variable "lock_table" {
  description = "Lock table from the bootstrap stack."
  type        = string
}

variable "state_kms_key_arn" {
  description = "State key from the bootstrap stack."
  type        = string
}
