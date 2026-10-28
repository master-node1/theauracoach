variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "github_repository" {
  description = "owner/repo allowed to assume the roles."
  type        = string
  default     = "master-node1/theauracoach"
}

variable "create_oidc_provider" {
  description = "Create the GitHub OIDC provider (false if the account already has one)."
  type        = bool
  default     = true
}

variable "deploy_environments" {
  description = "GitHub environments whose jobs may assume the deploy role."
  type        = list(string)
}

variable "ecr_repository_arns" {
  description = "Repositories the deploy role may push to."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "KMS key that encrypts ECR images."
  type        = string
}

variable "k3s_instance_arn" {
  description = "k3s node the deploy role may open a port forward to."
  type        = string
}

variable "state_bucket" {
  description = "Terraform state bucket."
  type        = string
}

variable "lock_table" {
  description = "Terraform lock table."
  type        = string
}

variable "state_kms_key_arn" {
  description = "KMS key of the state bucket."
  type        = string
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
