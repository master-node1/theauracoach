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

variable "public_hosts" {
  description = "Public hosts per environment served by this distribution, e.g. { prod = { web = \"app.auracoach.example\", api = \"api.auracoach.example\" } }. The same map is the Helm deploy input global.hosts, so the distribution, the IngressRoutes and the origin certificate agree."
  type = map(object({
    web = string
    api = string
  }))

  validation {
    condition     = length(var.public_hosts) > 0
    error_message = "public_hosts needs at least one environment."
  }

  # Environments on one distribution are told apart only by host, so no host may serve two of them.
  validation {
    condition     = length(distinct(flatten([for h in values(var.public_hosts) : [h.web, h.api]]))) == 2 * length(var.public_hosts)
    error_message = "Every environment needs its own web and api host; no host may be shared."
  }
}

variable "origin_hostname" {
  description = "DNS name CloudFront connects to, resolving to the node, e.g. origin.auracoach.example. Only the address: the viewer Host is forwarded, so TLS and routing use the public hosts."
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
