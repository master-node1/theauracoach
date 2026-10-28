output "distribution_id" {
  description = "CloudFront distribution ID."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = aws_cloudfront_distribution.this.arn
}

output "distribution_domain_name" {
  description = "CloudFront domain name."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "origin_verify_secret_arn" {
  description = "Secret holding the X-Origin-Verify value for Traefik."
  value       = aws_secretsmanager_secret.origin_verify.arn
}

output "aliases" {
  description = "Hosts on the distribution and its certificate."
  value       = local.aliases
}
