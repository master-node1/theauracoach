output "user_pool_id" {
  description = "User pool ID."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "User pool ARN."
  value       = aws_cognito_user_pool.this.arn
}

output "issuer" {
  description = "OIDC issuer (OIDC_ISSUER)."
  value       = "https://${aws_cognito_user_pool.this.endpoint}"
}

output "hosted_ui_url" {
  description = "Hosted UI base URL (OIDC_DOMAIN_URL)."
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${split("_", aws_cognito_user_pool.this.id)[0]}.amazoncognito.com"
}

output "web_client_id" {
  description = "Web BFF client ID."
  value       = aws_cognito_user_pool_client.web.id
}

output "mobile_client_id" {
  description = "Mobile client ID (EXPO_PUBLIC_OIDC_CLIENT_ID)."
  value       = aws_cognito_user_pool_client.mobile.id
}

output "identity_endpoint" {
  description = "Public cognito-idp endpoint (IDENTITY_ENDPOINT for web, mobile and profile-service)."
  value       = "https://cognito-idp.${split("_", aws_cognito_user_pool.this.id)[0]}.amazonaws.com/"
}
