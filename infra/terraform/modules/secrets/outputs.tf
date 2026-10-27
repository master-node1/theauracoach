output "secret_arns" {
  description = "Secret ARN by <environment>/<service>."
  value       = { for k, s in aws_secretsmanager_secret.service : k => s.arn }
}
