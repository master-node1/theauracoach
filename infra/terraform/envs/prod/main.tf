# Platform stack for the auracoach-prod account (ADR-007 Stage 1).
# Never applied by CI or Claude: the owner applies it (docs/operations/infrastructure.md).

locals {
  account_label = "prod"
  name_prefix   = "auracoach-prod"
  environments  = ["prod"]
  secret_prefix = "auracoach/prod/"

  services     = ["profile-service", "workout-service", "nutrition-service", "progress-service", "coach-service", "notification-service", "audit-service"]
  deployables  = concat(local.services, ["api-gateway", "web"])
  web_hostname = "app.${var.domain_name}"
  api_hostname = "api.${var.domain_name}"
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
  etcd_snapshot_retention_days = 14
  enable_replication           = true
  cloudfront_distribution_arn  = module.edge.distribution_arn
}

module "ecr" {
  source            = "../../modules/ecr"
  repository_prefix = "auracoach"
  repositories      = local.deployables
  kms_key_arn       = module.kms.key_arn
}

module "secrets" {
  source       = "../../modules/secrets"
  environments = local.environments
  services     = local.deployables
  kms_key_arn  = module.kms.key_arn
}

module "ses" {
  source             = "../../modules/ses"
  name_prefix        = local.name_prefix
  domain_name        = var.domain_name
  route53_zone_id    = var.route53_zone_id
  manage_dmarc       = var.dmarc_report_email != ""
  dmarc_report_email = var.dmarc_report_email
}

module "cognito" {
  source                     = "../../modules/cognito"
  name_prefix                = local.name_prefix
  secret_prefix              = local.secret_prefix
  kms_key_arn                = module.kms.key_arn
  hosted_ui_domain_prefix    = local.name_prefix
  web_app_urls               = ["https://${local.web_hostname}"]
  ses_identity_arn           = module.ses.identity_arn
  ses_configuration_set_name = module.ses.configuration_set_name
  from_email_address         = "AuraCoach <no-reply@${var.domain_name}>"
  google_client_id           = var.google_client_id
  google_client_secret       = var.google_client_secret
  apple_services_id          = var.apple_services_id
  apple_team_id              = var.apple_team_id
  apple_key_id               = var.apple_key_id
  apple_private_key          = var.apple_private_key
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
  etcd_snapshot_retention_days = 14
  secret_name_prefixes         = [local.secret_prefix]
  ecr_repository_arns          = module.ecr.repository_arns
  app_bucket_arns              = [module.storage.bucket_arns["user_private"], module.storage.bucket_arns["content_media"]]
  ses_identity_arn             = module.ses.identity_arn
  ses_configuration_set_arn    = module.ses.configuration_set_arn
  cognito_user_pool_arns       = [module.cognito.user_pool_arn]
  appconfig_application_arn    = module.appconfig.application_arn
  route53_zone_id              = var.route53_zone_id
  alarm_topic_arn              = module.observability.alert_topic_arn
  office_hours_schedule        = false
  termination_protection       = true
}

module "rds" {
  source                   = "../../modules/rds"
  providers                = { aws = aws, aws.dr = aws.dr }
  name_prefix              = local.name_prefix
  vpc_id                   = module.network.vpc_id
  subnet_ids               = module.network.isolated_subnet_ids
  client_security_group_id = module.k3s_node.security_group_id
  kms_key_arn              = module.kms.key_arn
  alarm_topic_arn          = module.observability.alert_topic_arn
}

module "redis" {
  source                   = "../../modules/redis"
  name_prefix              = local.name_prefix
  secret_prefix            = local.secret_prefix
  vpc_id                   = module.network.vpc_id
  subnet_ids               = module.network.isolated_subnet_ids
  client_security_group_id = module.k3s_node.security_group_id
  kms_key_arn              = module.kms.key_arn
  alarm_topic_arn          = module.observability.alert_topic_arn
}

module "edge" {
  source                           = "../../modules/edge"
  providers                        = { aws = aws, aws.us_east_1 = aws.us_east_1 }
  name_prefix                      = local.name_prefix
  secret_prefix                    = local.secret_prefix
  kms_key_arn                      = module.kms.key_arn
  route53_zone_id                  = var.route53_zone_id
  web_hostname                     = local.web_hostname
  api_hostname                     = local.api_hostname
  origin_hostname                  = "origin.${var.domain_name}"
  origin_ip                        = module.k3s_node.public_ip
  content_media_bucket_domain_name = module.storage.content_media_regional_domain_name
  enable_waf                       = true
  geo_allow_countries              = var.geo_allow_countries
}

module "dns_firewall" {
  source      = "../../modules/dns-firewall"
  name_prefix = local.name_prefix
  vpc_id      = module.network.vpc_id
  kms_key_arn = module.kms.key_arn
}

module "github_oidc" {
  source               = "../../modules/github-oidc"
  name_prefix          = local.name_prefix
  create_oidc_provider = var.create_github_oidc_provider
  deploy_environments  = local.environments
  ecr_repository_arns  = module.ecr.repository_arns
  kms_key_arn          = module.kms.key_arn
  k3s_instance_arn     = module.k3s_node.instance_arn
  state_bucket         = var.state_bucket
  lock_table           = var.lock_table
  state_kms_key_arn    = var.state_kms_key_arn
}
