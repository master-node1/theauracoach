output "identity_arn" {
  description = "SES domain identity ARN."
  value       = aws_sesv2_email_identity.domain.arn
}

output "configuration_set_name" {
  description = "Configuration set name (SES_CONFIGURATION_SET)."
  value       = aws_sesv2_configuration_set.this.configuration_set_name
}

output "configuration_set_arn" {
  description = "Configuration set ARN."
  value       = aws_sesv2_configuration_set.this.arn
}

output "dkim_tokens" {
  description = "DKIM tokens, for DNS managed outside Route 53."
  value       = aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens
}
