variable "name_prefix" {
  description = "Prefix for resource names, e.g. auracoach-prod."
  type        = string
}

variable "vpc_id" {
  description = "VPC to protect."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for the query log group."
  type        = string
}

variable "block_mode" {
  description = "Block non-listed domains (true) or only alert (false, for the first week after go-live)."
  type        = bool
  default     = true
}

variable "allowed_domains" {
  description = "Domains the workloads may resolve. Wildcards like *.amazonaws.com are allowed."
  type        = list(string)
  default = [
    # AWS APIs, ECR, S3, SSM, Cognito, SES, Secrets Manager, AppConfig.
    "amazonaws.com",
    "*.amazonaws.com",
    "*.aws",
    "*.amazoncognito.com",
    # VPC-internal names.
    "*.compute.internal",
    "*.ec2.internal",
    "*.cluster.local",
    # k3s install, ECR credential provider, Helm charts and images.
    "get.k3s.io",
    "github.com",
    "*.github.com",
    "*.githubusercontent.com",
    "artifacts.k8s.io",
    "registry.k8s.io",
    "*.pkg.dev",
    "ghcr.io",
    "quay.io",
    "*.quay.io",
    "charts.jetstack.io",
    "charts.external-secrets.io",
    "*.docker.io",
    "docker.io",
    "*.cloudfront.net",
    # Amazon Linux package repositories.
    "*.amazonlinux.com",
    # Let's Encrypt (cert-manager DNS-01).
    "acme-v02.api.letsencrypt.org",
    "*.letsencrypt.org",
    # AI provider (coach-service), food data, push, observability.
    "api.anthropic.com",
    "world.openfoodfacts.org",
    "*.openfoodfacts.org",
    "exp.host",
    "*.expo.dev",
    "*.grafana.net",
    "*.sentry.io",
    "sentry.io",
  ]
}

variable "tags" {
  description = "Extra tags for every resource."
  type        = map(string)
  default     = {}
}
