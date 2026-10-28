# Prod Redis (ADR-007 Stage 1): ElastiCache Redis 7 cache.t4g.micro, one node,
# TLS and AUTH, daily snapshot. Non-prod runs Redis as a StatefulSet on the
# node instead, so this module is only instantiated where enabled.

resource "random_password" "auth" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "auth" {
  #checkov:skip=CKV2_AWS_57:AUTH token rotation is a runbook step (ElastiCache supports ROTATE strategy)
  name        = "${var.secret_prefix}redis"
  description = "ElastiCache AUTH token and connection URL"
  kms_key_id  = var.kms_key_arn
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "auth" {
  secret_id = aws_secretsmanager_secret.auth.id
  secret_string = jsonencode({
    REDIS_URL = "rediss://:${random_password.auth.result}@${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
  })
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name_prefix
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis"
  description = "Redis from the k3s node only"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-redis" })
}

resource "aws_vpc_security_group_ingress_rule" "from_node" {
  security_group_id            = aws_security_group.redis.id
  description                  = "k3s node"
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  referenced_security_group_id = var.client_security_group_id
}

resource "aws_elasticache_parameter_group" "this" {
  name   = "${var.name_prefix}-redis7"
  family = "redis7"
  tags   = var.tags

  # BullMQ requires keys never be evicted.
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "this" {
  #checkov:skip=CKV2_AWS_50:Single node accepted for beta (ADR-007 Stage 1); events survive via the outbox
  replication_group_id = var.name_prefix
  description          = "${var.name_prefix} BullMQ, cache and Redis Streams"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.node_type
  num_cache_clusters   = 1
  port                 = 6379

  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.redis.id]
  parameter_group_name = aws_elasticache_parameter_group.this.name

  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true
  auth_token                 = random_password.auth.result

  automatic_failover_enabled = false
  multi_az_enabled           = false
  snapshot_retention_limit   = 1
  snapshot_window            = "21:00-22:00"
  maintenance_window         = "sun:22:00-sun:23:00"
  auto_minor_version_upgrade = true
  apply_immediately          = false

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "memory" {
  count               = var.alarm_topic_arn == "" ? 0 : 1
  alarm_name          = "${var.name_prefix}-redis-memory"
  alarm_description   = "Redis memory above 80%: with noeviction, writes fail when full"
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { CacheClusterId = "${aws_elasticache_replication_group.this.id}-001" }
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]
  tags                = var.tags
}
