output "instance_id" {
  description = "Node instance ID (target of the SSM port forward to 6443)."
  value       = aws_instance.node.id
}

output "instance_arn" {
  description = "Node instance ARN."
  value       = aws_instance.node.arn
}

output "public_ip" {
  description = "Elastic IP of the node."
  value       = aws_eip.node.public_ip
}

output "public_dns" {
  description = "Public DNS name of the Elastic IP."
  value       = aws_eip.node.public_dns
}

output "security_group_id" {
  description = "Node security group, allowed into the data stores."
  value       = aws_security_group.node.id
}

output "role_arn" {
  description = "Instance role ARN."
  value       = aws_iam_role.node.arn
}
