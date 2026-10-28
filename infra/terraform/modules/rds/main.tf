# Prod PostgreSQL (ADR-007 Stage 1): RDS PostgreSQL 16 single-AZ in the
# isolated subnets, PITR 14 days, weekly snapshot copy to the DR region.
# The master password is managed by RDS in Secrets Manager; per-service
# databases and users are created by scripts/bootstrap-secrets.sh.

data "aws_partition" "current" {}

resource "aws_db_subnet_group" "this" {
  name       = var.name_prefix
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-postgres"
  description = "PostgreSQL from the k3s node only"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-postgres" })
}

resource "aws_vpc_security_group_ingress_rule" "from_node" {
  security_group_id            = aws_security_group.db.id
  description                  = "k3s node"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = var.client_security_group_id
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name_prefix}-pg16"
  family = "postgres16"
  tags   = var.tags

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_disconnections"
    value = "1"
  }
}

data "aws_iam_policy_document" "monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  name               = "${var.name_prefix}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  role       = aws_iam_role.monitoring.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "this" {
  #checkov:skip=CKV_AWS_157:Single-AZ accepted for beta (ADR-007 Stage 1); PITR and DR copies cover it
  identifier     = var.name_prefix
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn

  db_name                       = "postgres"
  username                      = "auracoach_admin"
  manage_master_user_password   = true
  master_user_secret_kms_key_id = var.kms_key_arn

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = false

  iam_database_authentication_enabled = true
  backup_retention_period             = var.backup_retention_days
  backup_window                       = "20:30-21:00" # 02:00-02:30 IST
  maintenance_window                  = "sun:21:30-sun:22:30"
  copy_tags_to_snapshot               = true
  delete_automated_backups            = false
  deletion_protection                 = true
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "${var.name_prefix}-final"
  auto_minor_version_upgrade          = true

  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.kms_key_arn
  performance_insights_retention_period = 7
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.monitoring.arn

  tags = var.tags
}

# ---------- weekly cross-region copy (DR) ----------

data "aws_caller_identity" "dr" {
  provider = aws.dr
}

data "aws_iam_policy_document" "dr_key" {
  #checkov:skip=CKV_AWS_109:Key policy: "*" means this key
  #checkov:skip=CKV_AWS_111:Key policy: "*" means this key
  #checkov:skip=CKV_AWS_356:Key policy: "*" means this key
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.dr.account_id}:root"]
    }
  }
}

resource "aws_kms_key" "dr" {
  provider                = aws.dr
  description             = "${var.name_prefix} backup vault in the DR region"
  policy                  = data.aws_iam_policy_document.dr_key.json
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = var.tags
}

resource "aws_backup_vault" "dr" {
  provider    = aws.dr
  name        = "${var.name_prefix}-dr"
  kms_key_arn = aws_kms_key.dr.arn
  tags        = var.tags
}

resource "aws_backup_vault" "primary" {
  name        = var.name_prefix
  kms_key_arn = var.kms_key_arn
  tags        = var.tags
}

resource "aws_backup_plan" "weekly_dr_copy" {
  name = "${var.name_prefix}-weekly-dr"

  rule {
    rule_name         = "weekly-snapshot-copy"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(0 22 ? * SAT *)" # Sunday 03:30 IST
    lifecycle {
      delete_after = 35
    }
    copy_action {
      destination_vault_arn = aws_backup_vault.dr.arn
      lifecycle {
        delete_after = var.dr_copy_retention_days
      }
    }
  }

  tags = var.tags
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${var.name_prefix}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_selection" "rds" {
  name         = "${var.name_prefix}-rds"
  plan_id      = aws_backup_plan.weekly_dr_copy.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = [aws_db_instance.this.arn]
}

# ---------- alarms ----------

locals {
  alarms = {
    cpu = {
      metric    = "CPUUtilization"
      statistic = "Average"
      threshold = 80
      operator  = "GreaterThanThreshold"
      desc      = "RDS CPU above 80% for 15 minutes"
    }
    free_storage = {
      metric    = "FreeStorageSpace"
      statistic = "Minimum"
      threshold = 5 * 1024 * 1024 * 1024
      operator  = "LessThanThreshold"
      desc      = "RDS free storage below 5 GiB"
    }
    freeable_memory = {
      metric    = "FreeableMemory"
      statistic = "Minimum"
      threshold = 128 * 1024 * 1024
      operator  = "LessThanThreshold"
      desc      = "RDS freeable memory below 128 MiB"
    }
    connections = {
      metric    = "DatabaseConnections"
      statistic = "Maximum"
      threshold = 150
      operator  = "GreaterThanThreshold"
      desc      = "RDS connections above 150 (db.t4g.small allows about 190)"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "db" {
  for_each            = var.alarm_topic_arn == "" ? {} : local.alarms
  alarm_name          = "${var.name_prefix}-rds-${replace(each.key, "_", "-")}"
  alarm_description   = each.value.desc
  namespace           = "AWS/RDS"
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  period              = 300
  evaluation_periods  = 3
  threshold           = each.value.threshold
  comparison_operator = each.value.operator
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]
  tags                = var.tags
}
