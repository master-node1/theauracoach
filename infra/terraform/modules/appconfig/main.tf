# AWS AppConfig feature flags (TAC-10): application "auracoach" in each account,
# one AppConfig environment per app environment, and a hosted freeform profile
# "flags" (the names infra/helm values expect).
# Flag definitions are deployed by the release pipeline, not Terraform.

resource "aws_appconfig_application" "this" {
  name        = "auracoach"
  description = "AuraCoach feature flags"
  tags        = var.tags
}

resource "aws_appconfig_environment" "this" {
  for_each       = toset(var.environments)
  name           = each.value
  application_id = aws_appconfig_application.this.id
  description    = "${each.value} feature flags"
  tags           = var.tags
}

resource "aws_appconfig_configuration_profile" "flags" {
  application_id     = aws_appconfig_application.this.id
  name               = "flags"
  description        = "Feature flags read by services and the web BFF (platform LLD §11)"
  location_uri       = "hosted"
  type               = "AWS.Freeform"
  kms_key_identifier = var.kms_key_arn
  tags               = var.tags
}

# Roll a flag change out over 10 minutes and bake 10 more, so a bad flag can be
# rolled back before it reaches everyone.
resource "aws_appconfig_deployment_strategy" "gradual" {
  name                           = "${var.name_prefix}-gradual-10m"
  description                    = "Linear 20% steps over 10 minutes, 10 minute bake"
  deployment_duration_in_minutes = 10
  final_bake_time_in_minutes     = 10
  growth_factor                  = 20
  growth_type                    = "LINEAR"
  replicate_to                   = "NONE"
  tags                           = var.tags
}
