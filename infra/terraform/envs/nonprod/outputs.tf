output "k3s_instance_id" {
  description = "Target for: aws ssm start-session --target <id> --document-name AWS-StartPortForwardingSession --parameters portNumber=6443,localPortNumber=6443"
  value       = module.k3s_node.instance_id
}

output "node_public_ip" {
  description = "Elastic IP of the node (origin.<domain>, the address CloudFront connects to)."
  value       = module.k3s_node.public_ip
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain."
  value       = module.edge.distribution_domain_name
}

output "cloudfront_aliases" {
  description = "Hosts on the distribution; the deploy job checks helm_inputs.public_hosts against them."
  value       = module.edge.aliases
}

output "oidc" {
  description = "Values for the web and mobile app config, per environment."
  value = { for e, c in module.cognito : e => {
    issuer            = c.issuer
    identity_endpoint = c.identity_endpoint
    jwks_url          = c.jwks_url
    hosted_ui_url     = c.hosted_ui_url
    web_client_id     = c.web_client_id
    mobile_client_id  = c.mobile_client_id
  } }
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
  description = "Set as AWS_PLAN_ROLE_ARN / AWS_DEPLOY_ROLE_ARN in the GitHub dev and staging environments."
  value = {
    plan   = module.github_oidc.plan_role_arn
    deploy = module.github_oidc.deploy_role_arn
  }
}

output "helm_inputs" {
  description = "Deploy inputs for infra/helm (deployment.md §2): registry, secrets roles, public hosts, data-store CIDRs."
  value = {
    image_registry            = split("/", values(module.ecr.repository_urls)[0])[0]
    public_hosts              = local.hosts # = the CloudFront aliases (module.edge)
    secrets_role_arns         = module.k3s_node.secrets_role_arns
    platform_secrets_role_arn = module.k3s_node.platform_secrets_role_arn
    hosted_zone_id            = var.route53_zone_id
    web_app_urls              = { for e, h in local.hosts : e => "https://${h.web}" }
  }
}
