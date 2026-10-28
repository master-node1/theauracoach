output "application_id" {
  description = "AppConfig application ID."
  value       = aws_appconfig_application.this.id
}

output "application_arn" {
  description = "AppConfig application ARN."
  value       = aws_appconfig_application.this.arn
}

output "environment_ids" {
  description = "AppConfig environment ID by app environment."
  value       = { for k, e in aws_appconfig_environment.this : k => e.environment_id }
}

output "flags_profile_id" {
  description = "Feature-flag configuration profile ID."
  value       = aws_appconfig_configuration_profile.flags.configuration_profile_id
}
