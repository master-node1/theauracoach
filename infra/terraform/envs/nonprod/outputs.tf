output "k3s_instance_id" {
  description = "Target for: aws ssm start-session --target <id> --document-name AWS-StartPortForwardingSession --parameters portNumber=6443,localPortNumber=6443"
  value       = module.k3s_node.instance_id
}

output "node_public_ip" {
  description = "Elastic IP of the node (origin.<domain>)."
  value       = module.k3s_node.public_ip
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain."
  value       = module.edge.distribution_domain_name
}

output "oidc" {
  description = "Values for the web and mobile app config, per environment."
  value = { for e, c in module.cognito : e => {
    issuer            = c.issuer
    identity_endpoint = c.identity_endpoint
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
