output "plan_role_arn" {
  description = "Role for terraform plan in CI."
  value       = aws_iam_role.plan.arn
}

output "deploy_role_arn" {
  description = "Role for image push and deploy jobs."
  value       = aws_iam_role.deploy.arn
}
