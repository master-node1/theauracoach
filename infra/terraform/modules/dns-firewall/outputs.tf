output "rule_group_id" {
  description = "Firewall rule group ID."
  value       = aws_route53_resolver_firewall_rule_group.this.id
}
