output "k3s_instance_id" {
  description = "Target for: aws ssm start-session --target <id> --document-name AWS-StartPortForwardingSession --parameters portNumber=6443,localPortNumber=6443"
  value       = module.k3s_node.instance_id
}

output "node_public_ip" {
  description = "Elastic IP of the node (origin.<domain>)."
  value       = module.k3s_node.public_ip
}

output "rds_endpoint" {
  description = "PostgreSQL host for scripts/bootstrap-secrets.sh."
  value       = module.rds.endpoint
}

output "rds_master_secret_arn" {
  description = "RDS-managed master credentials."
  value       = module.rds.master_user_secret_arn
}

output "redis_secret_arn" {
  description = "Secret with REDIS_URL."
  value       = module.redis.secret_arn
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain."
  value       = module.edge.distribution_domain_name
}

output "oidc" {
  description = "Values for the web and mobile app config."
  value = {
    issuer            = module.cognito.issuer
    identity_endpoint = module.cognito.identity_endpoint
    jwks_url          = module.cognito.jwks_url
    hosted_ui_url     = module.cognito.hosted_ui_url
    web_client_id     = module.cognito.web_client_id
    mobile_client_id  = module.cognito.mobile_client_id
  }
}

output "ecr_repository_urls" {
  description = "Image repositories."
  value       = module.ecr.repository_urls
}

output "appconfig" {
  description = "AppConfig IDs for the flag client (TAC-10)."
  value = {
    application_id = module.appconfig.application_id
    environments   = module.appconfig.environment_ids
    profile_id     = module.appconfig.flags_profile_id
  }
}

output "buckets" {
  description = "S3 bucket names."
  value       = module.storage.bucket_names
}

output "github_roles" {
  description = "Set as AWS_PLAN_ROLE_ARN / AWS_DEPLOY_ROLE_ARN in the GitHub environment."
  value = {
    plan   = module.github_oidc.plan_role_arn
    deploy = module.github_oidc.deploy_role_arn
  }
}

output "helm_inputs" {
  description = "Deploy inputs for infra/helm (deployment.md §2): registry, secrets roles, origin host, data-store CIDRs."
  value = {
    image_registry            = split("/", values(module.ecr.repository_urls)[0])[0]
    origin_host               = "origin.${var.domain_name}"
    secrets_role_arns         = module.k3s_node.secrets_role_arns
    platform_secrets_role_arn = module.k3s_node.platform_secrets_role_arn
    hosted_zone_id            = var.route53_zone_id
    datastore_cidrs           = module.network.isolated_subnet_cidrs
    web_app_url               = "https://${local.web_hostname}"
  }
}
