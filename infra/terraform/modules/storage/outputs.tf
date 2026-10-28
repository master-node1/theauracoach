output "bucket_names" {
  description = "Bucket names by purpose: user_private, content_media, backups."
  value       = { for k, b in aws_s3_bucket.this : k => b.bucket }
}

output "bucket_arns" {
  description = "Bucket ARNs by purpose."
  value       = { for k, b in aws_s3_bucket.this : k => b.arn }
}

output "content_media_regional_domain_name" {
  description = "Regional domain of the content-media bucket, the CloudFront origin."
  value       = aws_s3_bucket.this["content_media"].bucket_regional_domain_name
}

output "logs_bucket_name" {
  description = "Access-log bucket."
  value       = aws_s3_bucket.logs.bucket
}
