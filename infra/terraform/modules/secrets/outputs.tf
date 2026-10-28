output "secret_arns" {
  description = "Secret ARN by <environment>/<service>."
  value       = { for k, s in aws_secretsmanager_secret.service : k => s.arn }
}

output "platform_secret_arn" {
  description = "Secret holding the cluster's Grafana Cloud credentials."
  value       = aws_secretsmanager_secret.platform.arn
}
