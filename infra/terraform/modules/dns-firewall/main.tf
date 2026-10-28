# Route 53 Resolver DNS Firewall (ADR-007): the VPC may resolve only
# allow-listed domains; everything else gets NXDOMAIN. It does not stop
# connections to raw IPs, which NetworkPolicy egress rules cover.

resource "aws_route53_resolver_firewall_domain_list" "allowed" {
  name    = "${var.name_prefix}-allowed"
  domains = var.allowed_domains
  tags    = var.tags
}

resource "aws_route53_resolver_firewall_domain_list" "everything" {
  name    = "${var.name_prefix}-everything"
  domains = ["*"]
  tags    = var.tags
}

resource "aws_route53_resolver_firewall_rule_group" "this" {
  name = var.name_prefix
  tags = var.tags
}

resource "aws_route53_resolver_firewall_rule" "allow" {
  name                    = "allow-listed"
  action                  = "ALLOW"
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.allowed.id
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.this.id
  priority                = 100
}

resource "aws_route53_resolver_firewall_rule" "block" {
  name                    = "block-rest"
  action                  = var.block_mode ? "BLOCK" : "ALERT"
  block_response          = var.block_mode ? "NXDOMAIN" : null
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.everything.id
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.this.id
  priority                = 200
}

resource "aws_route53_resolver_firewall_rule_group_association" "this" {
  name                   = var.name_prefix
  firewall_rule_group_id = aws_route53_resolver_firewall_rule_group.this.id
  vpc_id                 = var.vpc_id
  priority               = 101
  tags                   = var.tags
}

# Fail open if the firewall itself is unavailable, so DNS keeps working.
resource "aws_route53_resolver_firewall_config" "this" {
  resource_id        = var.vpc_id
  firewall_fail_open = "ENABLED"
}

resource "aws_cloudwatch_log_group" "query_log" {
  #checkov:skip=CKV_AWS_338:DNS query logs for 30 days; longer retention is a cost decision for TAC-41
  name              = "/aws/route53resolver/${var.name_prefix}"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

resource "aws_route53_resolver_query_log_config" "this" {
  name            = var.name_prefix
  destination_arn = aws_cloudwatch_log_group.query_log.arn
  tags            = var.tags
}

resource "aws_route53_resolver_query_log_config_association" "this" {
  resolver_query_log_config_id = aws_route53_resolver_query_log_config.this.id
  resource_id                  = var.vpc_id
}
