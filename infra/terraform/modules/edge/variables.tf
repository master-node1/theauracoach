variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "secret_prefix" {
  description = "Secrets Manager prefix, e.g. auracoach/prod/."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for the origin-verify secret."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone for the certificate validation, origin and alias records."
  type        = string
}

variable "web_hostname" {
  description = "Web app host, e.g. app.auracoach.example."
  type        = string
}

variable "api_hostname" {
  description = "API host, e.g. api.auracoach.example."
  type        = string
}

variable "extra_aliases" {
  description = "More hosts on the same distribution (e.g. staging hosts on the non-prod node)."
  type        = list(string)
  default     = []
}

variable "origin_hostname" {
  description = "Origin host that resolves to the node, e.g. origin.auracoach.example."
  type        = string
}

variable "origin_ip" {
  description = "Elastic IP of the k3s node."
  type        = string
}

variable "content_media_bucket_domain_name" {
  description = "Regional domain name of the content-media bucket."
  type        = string
}

variable "enable_waf" {
  description = "Attach a WAF web ACL (prod)."
  type        = bool
  default     = true
}

variable "rate_limit_per_5min" {
  description = "Requests per IP per 5 minutes before WAF blocks."
  type        = number
  default     = 2000
}

variable "auth_rate_limit_per_5min" {
  description = "Requests per IP per 5 minutes to /api/auth/* before WAF blocks."
  type        = number
  default     = 100
}

variable "geo_allow_countries" {
  description = "ISO country codes allowed; empty allows all."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
