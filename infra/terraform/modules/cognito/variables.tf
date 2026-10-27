variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "secret_prefix" {
  description = "Secrets Manager prefix, e.g. auracoach/prod/."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for the Lambda environment, logs and the client secret."
  type        = string
}

variable "hosted_ui_domain_prefix" {
  description = "Cognito hosted UI domain prefix (globally unique), e.g. auracoach-prod."
  type        = string
}

variable "user_pool_tier" {
  description = "Feature plan. PLUS is needed for threat protection (advanced security) with V2 token customisation."
  type        = string
  default     = "PLUS"
}

variable "advanced_security_mode" {
  description = "Threat protection mode: OFF, AUDIT or ENFORCED."
  type        = string
  default     = "ENFORCED"
}

variable "deletion_protection" {
  description = "Block deleting the user pool."
  type        = bool
  default     = true
}

variable "web_app_urls" {
  description = "Origins of the web app (no trailing slash); callback is <url>/api/auth/callback."
  type        = list(string)
}

variable "mobile_scheme" {
  description = "Deep-link scheme of the Expo app (apps/mobile AuthProvider)."
  type        = string
  default     = "auracoach"
}

variable "ses_identity_arn" {
  description = "SES identity Cognito sends from; null uses Cognito's default sender (50 emails/day)."
  type        = string
  default     = null
}

variable "ses_configuration_set_name" {
  description = "SES configuration set for Cognito mail."
  type        = string
  default     = null
}

variable "from_email_address" {
  description = "From address, e.g. AuraCoach <no-reply@example.com>."
  type        = string
  default     = null
}

variable "reply_to_email_address" {
  description = "Reply-to address."
  type        = string
  default     = null
}

variable "google_client_id" {
  description = "Google OAuth client ID; empty disables Google sign-in."
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth client secret."
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
  description = "Apple developer team ID."
  type        = string
  default     = ""
}

variable "apple_key_id" {
  description = "Apple Sign in key ID."
  type        = string
  default     = ""
}

variable "apple_private_key" {
  description = "Apple Sign in private key (PEM)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
