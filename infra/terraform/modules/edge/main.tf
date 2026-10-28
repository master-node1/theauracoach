# CloudFront in front of the k3s node's Traefik (ADR-007 Stage 1). Public TLS
# ends at CloudFront (ACM in us-east-1) and is re-encrypted to the node on 443.
# CloudFront connects to origin.<domain> (an A record on the node's Elastic IP)
# but forwards the viewer Host (AllViewer), so the TLS SNI and Host the node sees
# are the public hosts (app.<env>., api.<env>.): Traefik's IngressRoutes match
# them and the cert-manager certificate covers them (deployment.md "Edge
# routing"). CloudFront adds a secret X-Origin-Verify header that Traefik
# requires. content-media is a second origin through origin access control.
# WAF (managed rules + rate limits) is attached in prod.

locals {
  # One web and one api host per environment; the first environment's web host names the certificate.
  aliases = flatten([for e in sort(keys(var.public_hosts)) : [var.public_hosts[e].web, var.public_hosts[e].api]])
  # AWS managed policies.
  cache_disabled  = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
  cache_optimized = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
  # Forwards every viewer header including Host. tools/ci/check-edge-routing.mjs fails if this changes,
  # because the IngressRoutes and the origin certificate are built for the viewer hosts.
  origin_all_viewer      = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer
  traefik_origin_id      = "k3s-traefik"
  content_media_originid = "content-media"
}

# ---------- origin verification secret ----------

resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "origin_verify" {
  #checkov:skip=CKV2_AWS_57:Rotated with the CloudFront config (runbook), not by a rotation Lambda
  name        = "${var.secret_prefix}edge/origin-verify"
  description = "Value of the X-Origin-Verify header CloudFront sends and Traefik requires"
  kms_key_id  = var.kms_key_arn
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "origin_verify" {
  secret_id     = aws_secretsmanager_secret.origin_verify.id
  secret_string = jsonencode({ ORIGIN_VERIFY = random_password.origin_verify.result })
}

# ---------- certificate (us-east-1) ----------

resource "aws_acm_certificate" "viewer" {
  provider                  = aws.us_east_1
  domain_name               = local.aliases[0]
  subject_alternative_names = slice(local.aliases, 1, length(local.aliases))
  validation_method         = "DNS"
  tags                      = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.viewer.domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  }
  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 300
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "viewer" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.viewer.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ---------- origin DNS ----------

resource "aws_route53_record" "origin" {
  #checkov:skip=CKV2_AWS_23:Points at the k3s node Elastic IP, not an AWS alias target
  zone_id = var.route53_zone_id
  name    = var.origin_hostname
  type    = "A"
  ttl     = 300
  records = [var.origin_ip]
}

# ---------- WAF (us-east-1, CLOUDFRONT scope) ----------

resource "aws_wafv2_web_acl" "this" {
  #checkov:skip=CKV_AWS_192:KnownBadInputsRuleSet is added through a dynamic block that checkov cannot read
  count       = var.enable_waf ? 1 : 0
  provider    = aws.us_east_1
  name        = var.name_prefix
  description = "Managed rule groups and rate limits for ${var.name_prefix}"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-auth"
    priority = 0
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.auth_rate_limit_per_5min
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/auth/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-auth"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-ip"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.rate_limit_per_5min
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-ip"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = {
      AWSManagedRulesAmazonIpReputationList = 10
      AWSManagedRulesCommonRuleSet          = 20
      AWSManagedRulesKnownBadInputsRuleSet  = 30
      AWSManagedRulesSQLiRuleSet            = 40
    }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key
          # Coach chat and food logs send free text and photos in bodies larger than 8 KB.
          dynamic "rule_action_override" {
            for_each = rule.key == "AWSManagedRulesCommonRuleSet" ? ["SizeRestrictions_BODY"] : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name_prefix
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "waf" {
  #checkov:skip=CKV_AWS_158:Lives in us-east-1 where the platform key does not exist; authorization and cookie headers are redacted
  #checkov:skip=CKV_AWS_338:90 days covers incident review for WAF events
  count             = var.enable_waf ? 1 : 0
  provider          = aws.us_east_1
  name              = "aws-waf-logs-${var.name_prefix}"
  retention_in_days = 90
  tags              = var.tags
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  count                   = var.enable_waf ? 1 : 0
  provider                = aws.us_east_1
  resource_arn            = aws_wafv2_web_acl.this[0].arn
  log_destination_configs = [aws_cloudwatch_log_group.waf[0].arn]

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
}

# ---------- distribution ----------

resource "aws_cloudfront_origin_access_control" "content_media" {
  name                              = "${var.name_prefix}-content-media"
  description                       = "CloudFront reads content-media"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CachingOptimized plus Host in the cache key: the origin routes by Host, and environments that share
# the distribution (dev, staging) must never be served each other's build assets.
resource "aws_cloudfront_cache_policy" "static_by_host" {
  name        = "${var.name_prefix}-static-by-host"
  comment     = "Immutable build assets, cached per viewer host"
  min_ttl     = 1
  default_ttl = 86400
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Host"]
      }
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# Security headers on every response. The web app sets its own CSP (nonces), so
# CloudFront does not override it.
resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${var.name_prefix}-security"
  comment = "HSTS, nosniff, frame deny, referrer policy"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

resource "aws_cloudfront_distribution" "this" {
  #checkov:skip=CKV_AWS_86:Standard logging needs ACL-enabled buckets; WAF logs record prod requests and TAC-41 adds real-time logs if needed
  #checkov:skip=CKV_AWS_305:Next.js serves / dynamically; no static root object
  #checkov:skip=CKV_AWS_310:Single-node Stage 1 has no second origin to fail over to (ADR-007)
  #checkov:skip=CKV2_AWS_47:WAF is attached in prod with AWSManagedRulesKnownBadInputsRuleSet (Log4j); non-prod has no WAF by design
  enabled         = true
  is_ipv6_enabled = true
  comment         = var.name_prefix
  aliases         = local.aliases
  price_class     = "PriceClass_200" # includes India edge locations
  http_version    = "http2and3"
  web_acl_id      = var.enable_waf ? aws_wafv2_web_acl.this[0].arn : null

  origin {
    origin_id   = local.traefik_origin_id
    domain_name = var.origin_hostname
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60 # coach streaming (SSE)
      origin_keepalive_timeout = 60
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  origin {
    origin_id                = local.content_media_originid
    domain_name              = var.content_media_bucket_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.content_media.id
  }

  default_cache_behavior {
    target_origin_id           = local.traefik_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cache_disabled
    origin_request_policy_id   = local.origin_all_viewer
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  ordered_cache_behavior {
    path_pattern               = "/_next/static/*"
    target_origin_id           = local.traefik_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.static_by_host.id
    origin_request_policy_id   = local.origin_all_viewer
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  ordered_cache_behavior {
    path_pattern               = "/media/*"
    target_origin_id           = local.content_media_originid
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cache_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = length(var.geo_allow_countries) == 0 ? "none" : "whitelist"
      locations        = var.geo_allow_countries
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.viewer.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = var.tags
}

resource "aws_route53_record" "alias" {
  for_each = toset(local.aliases)
  zone_id  = var.route53_zone_id
  name     = each.value
  type     = "A"
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_ipv6" {
  for_each = toset(local.aliases)
  zone_id  = var.route53_zone_id
  name     = each.value
  type     = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
