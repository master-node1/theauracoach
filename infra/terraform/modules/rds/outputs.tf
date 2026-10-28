output "endpoint" {
  description = "Host name of the instance."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "Port of the instance."
  value       = aws_db_instance.this.port
}

output "master_user_secret_arn" {
  description = "Secrets Manager secret RDS manages for the master user."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "instance_arn" {
  description = "DB instance ARN."
  value       = aws_db_instance.this.arn
}
