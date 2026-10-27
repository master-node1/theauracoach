output "vpc_id" {
  description = "VPC ID."
  value       = aws_vpc.this.id
}

output "vpc_cidr_block" {
  description = "VPC CIDR."
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_id" {
  description = "Public subnet for the k3s node."
  value       = aws_subnet.public.id
}

output "isolated_subnet_cidrs" {
  description = "CIDRs of the isolated subnets (NetworkPolicy egress to RDS and ElastiCache)."
  value       = aws_subnet.isolated[*].cidr_block
}

output "isolated_subnet_ids" {
  description = "Isolated subnets (no internet route) for RDS and ElastiCache."
  value       = aws_subnet.isolated[*].id
}
