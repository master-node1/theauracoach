# One Secrets Manager entry per service and environment, read by External
# Secrets Operator (infra/helm). Terraform creates the containers only: values
# are written by scripts/bootstrap-secrets.sh and by the owner (provider API
# keys, Grafana Cloud credentials), so these values never live in Terraform state.

locals {
  # Per deployable, plus "shared" (INTERNAL_TOKEN_SECRET) and, where the
  # environment runs in-cluster Postgres and Redis, "datastores" (deployment.md §3).
  names = concat(var.services, ["shared"], var.in_cluster_datastores ? ["datastores"] : [])
  entries = { for pair in setproduct(var.environments, local.names) : "${pair[0]}/${pair[1]}" => {
    environment = pair[0]
    service     = pair[1]
  } }
}

resource "aws_secretsmanager_secret" "service" {
  #checkov:skip=CKV2_AWS_57:Values are DB passwords and provider keys rotated by runbook; Stage 2 adds rotation Lambdas
  for_each                = local.entries
  name                    = "${var.project}/${each.key}"
  description             = "Runtime secrets for ${each.value.service} in ${each.value.environment}"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_days
  tags                    = merge(var.tags, { Environment = each.value.environment, Service = each.value.service })
}

# Grafana Cloud OTLP credentials for the cluster's collector.
resource "aws_secretsmanager_secret" "platform" {
  #checkov:skip=CKV2_AWS_57:Grafana Cloud token, rotated by the owner
  name                    = "${var.project}/${var.cluster_label}/platform"
  description             = "Grafana Cloud OTLP endpoint, instance ID and token for the ${var.cluster_label} cluster"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_days
  tags                    = var.tags
}
