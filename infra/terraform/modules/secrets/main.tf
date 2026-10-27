# One Secrets Manager entry per service and environment, read by External
# Secrets Operator (infra/helm). Terraform creates the containers only: values
# are written by scripts/bootstrap-databases.sh (DATABASE_URL) and by the owner
# (provider API keys), so no secret value lives in Terraform state.

locals {
  entries = { for pair in setproduct(var.environments, var.services) : "${pair[0]}/${pair[1]}" => {
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
