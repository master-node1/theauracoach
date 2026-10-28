# Platform stack for the auracoach-nonprod account (ADR-007 Stage 1): dev and
# staging share one k3s node (namespaces), with Postgres and Redis running as
# StatefulSets on it, so there is no RDS or ElastiCache here. The node stops
# out of hours. No WAF (synthetic data only).
# Never applied by CI or Claude: the owner applies it (docs/operations/infrastructure.md).

locals {
  account_label = "nonprod"
  name_prefix   = "auracoach-nonprod"
  environments  = ["dev", "staging"]

  services    = ["profile-service", "workout-service", "nutrition-service", "progress-service", "coach-service", "notification-service", "audit-service"]
  deployables = concat(local.services, ["api-gateway", "web"])
  hosts = { for e in local.environments : e => {
    web = "app.${e}.${var.domain_name}"
    api = "api.${e}.${var.domain_name}"
  } }

  # Bundled Traefik config from infra/k3s (TAC-35), applied by k3s at first boot.
  traefik_config   = "${path.module}/../../../k3s/traefik-config.yaml"
  server_manifests = fileexists(local.traefik_config) ? { "traefik-config.yaml" = file(local.traefik_config) } : {}
}

module "kms" {
  source      = "../../modules/kms"
  name_prefix = local.name_prefix
}

module "network" {
  source      = "../../modules/network"
  name_prefix = local.name_prefix
  region      = var.region
  cidr_block  = var.vpc_cidr
  kms_key_arn = module.kms.key_arn
}

module "observability" {
  source             = "../../modules/observability"
  name_prefix        = local.name_prefix
  kms_key_arn        = module.kms.key_arn
  alert_emails       = var.alert_emails
  monthly_budget_usd = var.monthly_budget_usd
}

module "storage" {
  source                       = "../../modules/storage"
  providers                    = { aws = aws, aws.dr = aws.dr }
  name_prefix                  = local.name_prefix
  kms_key_arn                  = module.kms.key_arn
  etcd_snapshot_retention_days = 3
  enable_replication           = false
  cloudfront_distribution_arn  = module.edge.distribution_arn
}

module "ecr" {
  source            = "../../modules/ecr"
  repository_prefix = "auracoach"
  repositories      = local.deployables
  kms_key_arn       = module.kms.key_arn
  pull_account_ids  = var.prod_account_id == "" ? [] : [var.prod_account_id]
}

module "secrets" {
  source                = "../../modules/secrets"
  environments          = local.environments
  services              = local.deployables
  cluster_label         = local.account_label
  in_cluster_datastores = true
  kms_key_arn           = module.kms.key_arn
}

module "ses" {
  source             = "../../modules/ses"
  name_prefix        = local.name_prefix
  domain_name        = var.domain_name
  route53_zone_id    = var.route53_zone_id
  manage_dmarc       = var.dmarc_report_email != ""
  dmarc_report_email = var.dmarc_report_email
}

# One user pool per environment so staging tests never touch dev accounts.
module "cognito" {
  source                     = "../../modules/cognito"
  for_each                   = local.hosts
  name_prefix                = "auracoach-${each.key}"
  kms_key_arn                = module.kms.key_arn
  hosted_ui_domain_prefix    = "auracoach-${each.key}"
  web_app_urls               = each.key == "dev" ? ["https://${each.value.web}", "http://localhost:3100"] : ["https://${each.value.web}"]
  ses_identity_arn           = module.ses.identity_arn
  ses_configuration_set_name = module.ses.configuration_set_name
  from_email_address         = "AuraCoach ${each.key} <no-reply@${var.domain_name}>"
  # Synthetic users only: audit rather than block, and allow tearing the pool down.
  advanced_security_mode = "AUDIT"
  deletion_protection    = false
  google_client_id       = var.google_client_id
  google_client_secret   = var.google_client_secret
  apple_services_id      = var.apple_services_id
  apple_team_id          = var.apple_team_id
  apple_key_id           = var.apple_key_id
  apple_private_key      = var.apple_private_key
}

module "appconfig" {
  source       = "../../modules/appconfig"
  name_prefix  = local.name_prefix
  environments = local.environments
  kms_key_arn  = module.kms.key_arn
}

module "k3s_node" {
  source                       = "../../modules/k3s-node"
  name_prefix                  = local.name_prefix
  environment_label            = local.account_label
  account_id                   = var.aws_account_id
  vpc_id                       = module.network.vpc_id
  vpc_cidr_block               = module.network.vpc_cidr_block
  subnet_id                    = module.network.public_subnet_id
  instance_type                = var.node_instance_type
  kms_key_arn                  = module.kms.key_arn
  etcd_snapshot_bucket_name    = module.storage.bucket_names["backups"]
  etcd_snapshot_bucket_arn     = module.storage.bucket_arns["backups"]
  etcd_snapshot_retention_days = 3
  secret_environments          = local.environments
  server_manifests             = local.server_manifests
  ecr_repository_arns          = module.ecr.repository_arns
  app_bucket_arns              = [module.storage.bucket_arns["user_private"], module.storage.bucket_arns["content_media"]]
  ses_identity_arn             = module.ses.identity_arn
  ses_configuration_set_arn    = module.ses.configuration_set_arn
  cognito_user_pool_arns       = [for c in module.cognito : c.user_pool_arn]
  appconfig_application_arn    = module.appconfig.application_arn
  route53_zone_id              = var.route53_zone_id
  alarm_topic_arn              = module.observability.alert_topic_arn
  office_hours_schedule        = true
  termination_protection       = false
}

module "edge" {
  source                           = "../../modules/edge"
  providers                        = { aws = aws, aws.us_east_1 = aws.us_east_1 }
  name_prefix                      = local.name_prefix
  secret_prefix                    = "auracoach/nonprod/"
  kms_key_arn                      = module.kms.key_arn
  route53_zone_id                  = var.route53_zone_id
  web_hostname                     = local.hosts.dev.web
  api_hostname                     = local.hosts.dev.api
  extra_aliases                    = [local.hosts.staging.web, local.hosts.staging.api]
  origin_hostname                  = "origin.${var.domain_name}"
  origin_ip                        = module.k3s_node.public_ip
  content_media_bucket_domain_name = module.storage.content_media_regional_domain_name
  enable_waf                       = false
  geo_allow_countries              = var.geo_allow_countries
}

module "dns_firewall" {
  source      = "../../modules/dns-firewall"
  name_prefix = local.name_prefix
  vpc_id      = module.network.vpc_id
  kms_key_arn = module.kms.key_arn
}

module "github_oidc" {
  source                   = "../../modules/github-oidc"
  name_prefix              = local.name_prefix
  create_oidc_provider     = var.create_github_oidc_provider
  deploy_environments      = local.environments
  ecr_repository_arns      = module.ecr.repository_arns
  origin_verify_secret_arn = module.edge.origin_verify_secret_arn
  kms_key_arn              = module.kms.key_arn
  k3s_instance_arn         = module.k3s_node.instance_arn
  state_bucket             = var.state_bucket
  lock_table               = var.lock_table
  state_kms_key_arn        = var.state_kms_key_arn
}
