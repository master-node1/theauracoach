variable "repository_prefix" {
  description = "Namespace for repositories, e.g. auracoach."
  type        = string
}

variable "repositories" {
  description = "Deployables that get a repository (services, api-gateway, web)."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "KMS key for image encryption."
  type        = string
}

variable "keep_images" {
  description = "Tagged images to keep per repository."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}

variable "pull_account_ids" {
  description = "Other AWS accounts allowed to pull (the prod account, to promote images built in non-prod by digest)."
  type        = list(string)
  default     = []
}
