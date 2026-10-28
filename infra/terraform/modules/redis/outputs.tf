output "primary_endpoint" {
  description = "Primary endpoint host."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "secret_arn" {
  description = "Secret holding REDIS_URL with the AUTH token."
  value       = aws_secretsmanager_secret.auth.arn
}
