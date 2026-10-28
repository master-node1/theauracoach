output "alert_topic_arn" {
  description = "SNS topic for alarms."
  value       = aws_sns_topic.alerts.arn
}
