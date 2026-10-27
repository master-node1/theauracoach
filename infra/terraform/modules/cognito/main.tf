# Cognito user pool (ADR-006): email sign-in, verification, threat protection,
# optional Google and Apple federation, a confidential client for the web BFF
# and a public PKCE client for mobile, RBAC groups, and the pre-token-generation
# trigger that adds the email claim to access tokens.

locals {
  idp_google = var.google_client_id != ""
  idp_apple  = var.apple_services_id != ""
  identity_providers = concat(
    ["COGNITO"],
    local.idp_google ? ["Google"] : [],
    local.idp_apple ? ["SignInWithApple"] : [],
  )
  # In-app email sign-in (TAC-8, PR #10) uses the public cognito-idp API:
  # USER_PASSWORD_AUTH, USER_AUTH (choice-based) and refresh. The hosted UI
  # (code flow) stays available for Google, Apple and "More sign-in options".
  auth_flows = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  # Roles from HLD §RBAC; profile-service mirrors grants into these groups.
  groups = {
    user               = "End user (default)"
    content_editor     = "Edits exercises, templates, foods and recipes"
    nutrition_reviewer = "Reviews and publishes nutrition content"
    safety_reviewer    = "Reviews safety content and flagged AI replies"
    ai_admin           = "Manages prompts, model configs and AI policies"
    support            = "Masked support view of users"
    owner              = "Full administrative access"
  }
}

# ---------- pre-token-generation Lambda ----------

data "archive_file" "pre_token" {
  type        = "zip"
  source_file = "${path.module}/lambda/index.mjs"
  output_path = "${path.module}/.build/pre-token.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pre_token" {
  name               = "${var.name_prefix}-cognito-pre-token"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = var.tags
}

resource "aws_cloudwatch_log_group" "pre_token" {
  #checkov:skip=CKV_AWS_338:Trigger logs hold no personal data; 30 days is enough
  name              = "/aws/lambda/${var.name_prefix}-cognito-pre-token"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

data "aws_iam_policy_document" "pre_token_logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.pre_token.arn}:*"]
  }
}

resource "aws_iam_role_policy" "pre_token_logs" {
  name   = "write-logs"
  role   = aws_iam_role.pre_token.id
  policy = data.aws_iam_policy_document.pre_token_logs.json
}

resource "aws_lambda_function" "pre_token" {
  #checkov:skip=CKV_AWS_116:Synchronous Cognito trigger; a DLQ never receives anything
  #checkov:skip=CKV_AWS_117:Calls no network resources; a VPC adds ENI cold starts for nothing
  #checkov:skip=CKV_AWS_272:Code is built from this repository by Terraform; signing adds no assurance here
  function_name    = "${var.name_prefix}-cognito-pre-token"
  role             = aws_iam_role.pre_token.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.pre_token.output_path
  source_code_hash = data.archive_file.pre_token.output_base64sha256
  memory_size      = 128
  timeout          = 5
  # Cognito waits on this function; cap it so a burst cannot starve the account.
  reserved_concurrent_executions = 20

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.pre_token.name
  }

  tags = var.tags
}

resource "aws_lambda_permission" "cognito" {
  statement_id  = "AllowCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_token.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.this.arn
}

# ---------- user pool ----------

resource "aws_cognito_user_pool" "this" {
  name                     = var.name_prefix
  user_pool_tier           = var.user_pool_tier
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  # TOTP is available to everyone and required for admin roles by the API (TAC-9);
  # Cognito cannot require MFA per group.
  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 3
    password_history_size            = 5
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  username_configuration {
    case_sensitive = false
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your AuraCoach verification code"
    email_message        = "Your AuraCoach verification code is {####}. It expires in 24 hours."
  }

  dynamic "email_configuration" {
    for_each = var.ses_identity_arn == null ? [] : [1]
    content {
      email_sending_account  = "DEVELOPER"
      source_arn             = var.ses_identity_arn
      from_email_address     = var.from_email_address
      configuration_set      = var.ses_configuration_set_name
      reply_to_email_address = var.reply_to_email_address
    }
  }

  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD"]
  }

  user_pool_add_ons {
    advanced_security_mode = var.advanced_security_mode
  }

  lambda_config {
    pre_token_generation_config {
      lambda_arn     = aws_lambda_function.pre_token.arn
      lambda_version = "V2_0"
    }
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 5
      max_length = 254
    }
  }

  tags = var.tags

  lifecycle {
    # Cognito cannot change the schema after creation.
    ignore_changes = [schema]
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.hosted_ui_domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_group" "this" {
  for_each     = local.groups
  name         = each.key
  description  = each.value
  user_pool_id = aws_cognito_user_pool.this.id
}

# ---------- federated identity providers ----------

resource "aws_cognito_identity_provider" "google" {
  count         = local.idp_google ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.this.id
  provider_name = "Google"
  provider_type = "Google"
  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }
  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    username       = "sub"
  }
}

resource "aws_cognito_identity_provider" "apple" {
  count         = local.idp_apple ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.this.id
  provider_name = "SignInWithApple"
  provider_type = "SignInWithApple"
  provider_details = {
    client_id        = var.apple_services_id
    team_id          = var.apple_team_id
    key_id           = var.apple_key_id
    private_key      = var.apple_private_key
    authorize_scopes = "email"
  }
  attribute_mapping = {
    email    = "email"
    username = "sub"
  }
}

# ---------- app clients ----------

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${var.name_prefix}-web-bff"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = [for u in var.web_app_urls : "${u}/api/auth/callback"]
  logout_urls                          = [for u in var.web_app_urls : "${u}/"]
  supported_identity_providers         = local.identity_providers
  explicit_auth_flows                  = local.auth_flows
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
  depends_on = [aws_cognito_identity_provider.google, aws_cognito_identity_provider.apple]
}

resource "aws_cognito_user_pool_client" "mobile" {
  name                                 = "${var.name_prefix}-mobile"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = ["${var.mobile_scheme}://callback"]
  logout_urls                          = ["${var.mobile_scheme}://signed-out"]
  supported_identity_providers         = local.identity_providers
  explicit_auth_flows                  = local.auth_flows
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
  depends_on = [aws_cognito_identity_provider.google, aws_cognito_identity_provider.apple]
}

# The BFF reads its client secret from Secrets Manager like every other secret.
resource "aws_secretsmanager_secret" "web_client" {
  #checkov:skip=CKV2_AWS_57:Cognito client secret; rotated by recreating the client (runbook)
  name        = "${var.secret_prefix}web/oidc"
  description = "Cognito web BFF client id and secret"
  kms_key_id  = var.kms_key_arn
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "web_client" {
  secret_id = aws_secretsmanager_secret.web_client.id
  secret_string = jsonencode({
    OIDC_CLIENT_ID     = aws_cognito_user_pool_client.web.id
    OIDC_CLIENT_SECRET = aws_cognito_user_pool_client.web.client_secret
  })
}
