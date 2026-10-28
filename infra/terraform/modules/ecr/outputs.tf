output "repository_urls" {
  description = "Repository URL by deployable."
  value       = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "repository_arns" {
  description = "Repository ARNs."
  value       = [for r in aws_ecr_repository.this : r.arn]
}
