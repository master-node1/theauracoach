variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "domain_name" {
  description = "Sending domain, e.g. auracoach.example or dev.auracoach.example."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone for the DKIM, MAIL FROM and DMARC records; null if DNS is managed elsewhere."
  type        = string
  default     = null
}

variable "manage_dmarc" {
  description = "Create the _dmarc record (only for the apex sending domain)."
  type        = bool
  default     = false
}

variable "dmarc_report_email" {
  description = "Address that receives DMARC aggregate reports."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
