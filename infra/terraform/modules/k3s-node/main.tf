# The single k3s server node of an account (ADR-007 Stage 1): Graviton EC2 in
# the public subnet with an Elastic IP, IMDSv2 only, reachable only through SSM
# (no SSH, no public 6443), and inbound 443 only from CloudFront.

data "aws_region" "current" {}
data "aws_partition" "current" {}

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_ec2_managed_prefix_list" "cloudfront_origin" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

locals {
  node_name = "${var.name_prefix}-k3s"
  arn       = data.aws_partition.current.partition
  region    = data.aws_region.current.name
}

# ---------- security group ----------

resource "aws_security_group" "node" {
  name        = "${local.node_name}-node"
  description = "k3s node: 443 from CloudFront only; no SSH or Kubernetes API from outside"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${local.node_name}-node" })
}

resource "aws_vpc_security_group_ingress_rule" "https_from_cloudfront" {
  security_group_id = aws_security_group.node.id
  description       = "Traefik origin, CloudFront origin-facing addresses only"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin.id
}

# Outbound 443 is needed for ECR, AWS APIs, the AI provider and the other
# allow-listed domains; the Route 53 DNS Firewall and NetworkPolicies narrow it.
resource "aws_vpc_security_group_egress_rule" "https_out" {
  security_group_id = aws_security_group.node.id
  description       = "HTTPS to AWS APIs and allow-listed domains"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "dns_udp" {
  security_group_id = aws_security_group.node.id
  description       = "VPC resolver (DNS Firewall applies)"
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr_block
}

resource "aws_vpc_security_group_egress_rule" "dns_tcp" {
  security_group_id = aws_security_group.node.id
  description       = "VPC resolver (DNS Firewall applies)"
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr_block
}

resource "aws_vpc_security_group_egress_rule" "postgres" {
  security_group_id = aws_security_group.node.id
  description       = "RDS PostgreSQL in the isolated subnets"
  ip_protocol       = "tcp"
  from_port         = 5432
  to_port           = 5432
  cidr_ipv4         = var.vpc_cidr_block
}

resource "aws_vpc_security_group_egress_rule" "redis" {
  security_group_id = aws_security_group.node.id
  description       = "ElastiCache Redis in the isolated subnets"
  ip_protocol       = "tcp"
  from_port         = 6379
  to_port           = 6379
  cidr_ipv4         = var.vpc_cidr_block
}

# ---------- instance role ----------

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = local.node_name
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:${local.arn}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Shared by every pod that may reach the metadata endpoint (NetworkPolicy
# decides which), so each statement is scoped to this environment's resources.
data "aws_iam_policy_document" "node" {
  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [for p in var.secret_name_prefixes : "arn:${local.arn}:secretsmanager:${local.region}:${var.account_id}:secret:${p}*"]
  }

  statement {
    sid       = "ListSecretsForExternalSecrets"
    actions   = ["secretsmanager:ListSecrets"]
    resources = ["*"]
  }

  statement {
    sid       = "UseDataKey"
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [var.kms_key_arn]
  }

  statement {
    sid       = "PullImages"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "PullOwnRepositories"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = var.ecr_repository_arns
  }

  statement {
    sid       = "EtcdSnapshots"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [var.etcd_snapshot_bucket_arn]
  }

  statement {
    sid       = "EtcdSnapshotObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.etcd_snapshot_bucket_arn}/k3s-etcd/*"]
  }

  statement {
    sid       = "PublishKubeconfig"
    actions   = ["ssm:PutParameter"]
    resources = ["arn:${local.arn}:ssm:${local.region}:${var.account_id}:parameter/${var.name_prefix}/k3s/*"]
  }

  dynamic "statement" {
    for_each = var.route53_zone_id == null ? [] : [1]
    content {
      sid       = "CertManagerDns01"
      actions   = ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets"]
      resources = ["arn:${local.arn}:route53:::hostedzone/${var.route53_zone_id}"]
    }
  }

  dynamic "statement" {
    for_each = var.route53_zone_id == null ? [] : [1]
    content {
      sid       = "CertManagerDns01Lookup"
      actions   = ["route53:GetChange", "route53:ListHostedZonesByName"]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = length(var.app_bucket_arns) > 0 ? [1] : []
    content {
      sid       = "AppBucketsList"
      actions   = ["s3:ListBucket"]
      resources = var.app_bucket_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.app_bucket_arns) > 0 ? [1] : []
    content {
      sid       = "AppBucketsObjects"
      actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      resources = [for b in var.app_bucket_arns : "${b}/*"]
    }
  }

  dynamic "statement" {
    for_each = var.ses_identity_arn == null ? [] : [1]
    content {
      sid       = "SendMail"
      actions   = ["ses:SendEmail", "ses:SendRawEmail"]
      resources = [var.ses_identity_arn, var.ses_configuration_set_arn]
    }
  }

  dynamic "statement" {
    for_each = length(var.cognito_user_pool_arns) == 0 ? [] : [1]
    content {
      sid = "CognitoAdmin"
      actions = [
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminRemoveUserFromGroup",
        "cognito-idp:AdminListGroupsForUser",
        "cognito-idp:AdminUserGlobalSignOut",
        "cognito-idp:AdminDisableUser",
        "cognito-idp:AdminEnableUser",
        "cognito-idp:AdminDeleteUser",
      ]
      resources = var.cognito_user_pool_arns
    }
  }

  dynamic "statement" {
    for_each = var.appconfig_application_arn == null ? [] : [1]
    content {
      sid       = "ReadFeatureFlags"
      actions   = ["appconfig:StartConfigurationSession", "appconfig:GetLatestConfiguration"]
      resources = ["${var.appconfig_application_arn}/*"]
    }
  }
}

resource "aws_iam_role_policy" "node" {
  name   = "node-workloads"
  role   = aws_iam_role.node.id
  policy = data.aws_iam_policy_document.node.json
}

resource "aws_iam_instance_profile" "node" {
  name = local.node_name
  role = aws_iam_role.node.name
  tags = var.tags
}

# ---------- instance ----------

resource "aws_instance" "node" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.node.id]
  iam_instance_profile   = aws_iam_instance_profile.node.name
  ebs_optimized          = true
  monitoring             = true

  user_data_replace_on_change = false
  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    node_name                       = local.node_name
    name_prefix                     = var.name_prefix
    kms_key_arn                     = var.kms_key_arn
    environment                     = var.environment_label
    region                          = local.region
    k3s_version                     = var.k3s_version
    ecr_credential_provider_version = var.ecr_credential_provider_version
    etcd_snapshot_bucket            = var.etcd_snapshot_bucket_name
    etcd_snapshot_retention         = var.etcd_snapshot_retention_days * 4
  })

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    http_endpoint               = "enabled"
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    kms_key_id            = var.kms_key_arn
    delete_on_termination = true
  }

  disable_api_termination = var.termination_protection

  tags = merge(var.tags, {
    Name              = local.node_name
    "auracoach:role"  = "k3s-server"
    "Patch Group"     = local.node_name
    "auracoach:sched" = var.office_hours_schedule ? "office-hours" : "always-on"
  })
  volume_tags = merge(var.tags, { Name = local.node_name })

  lifecycle {
    # New AMIs are rolled out by rebuilding the node on purpose (runbook), not on every plan.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "node" {
  domain   = "vpc"
  instance = aws_instance.node.id
  tags     = merge(var.tags, { Name = local.node_name })
}

# ---------- recovery alarms ----------

resource "aws_cloudwatch_metric_alarm" "system_recover" {
  alarm_name          = "${local.node_name}-system-status-recover"
  alarm_description   = "Host failure: EC2 auto-recovery moves the instance to healthy hardware (same EBS and IP)."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { InstanceId = aws_instance.node.id }
  alarm_actions       = compact(["arn:${local.arn}:automate:${local.region}:ec2:recover", var.alarm_topic_arn])
  ok_actions          = compact([var.alarm_topic_arn])
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "instance_reboot" {
  alarm_name          = "${local.node_name}-instance-status-reboot"
  alarm_description   = "Guest OS unresponsive: reboot the instance."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { InstanceId = aws_instance.node.id }
  alarm_actions       = compact(["arn:${local.arn}:automate:${local.region}:ec2:reboot", var.alarm_topic_arn])
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "${local.node_name}-cpu-high"
  alarm_description   = "Node CPU above 80% for 15 minutes (ADR-007 Stage 2 trigger watch)."
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { InstanceId = aws_instance.node.id }
  alarm_actions       = compact([var.alarm_topic_arn])
  tags                = var.tags
}

# ---------- weekly patching (Sunday 03:00 IST) ----------

resource "aws_ssm_maintenance_window" "patch" {
  name              = "${local.node_name}-patch"
  schedule          = "cron(0 3 ? * SUN *)"
  schedule_timezone = "Asia/Kolkata"
  duration          = 2
  cutoff            = 1
  tags              = var.tags
}

resource "aws_ssm_maintenance_window_target" "patch" {
  window_id     = aws_ssm_maintenance_window.patch.id
  resource_type = "INSTANCE"
  targets {
    key    = "InstanceIds"
    values = [aws_instance.node.id]
  }
}

resource "aws_ssm_maintenance_window_task" "patch" {
  window_id       = aws_ssm_maintenance_window.patch.id
  task_type       = "RUN_COMMAND"
  task_arn        = "AWS-RunPatchBaseline"
  max_concurrency = "1"
  max_errors      = "1"
  priority        = 1

  targets {
    key    = "WindowTargetIds"
    values = [aws_ssm_maintenance_window_target.patch.id]
  }

  task_invocation_parameters {
    run_command_parameters {
      parameter {
        name   = "Operation"
        values = ["Install"]
      }
      parameter {
        name   = "RebootOption"
        values = ["RebootIfNeeded"]
      }
    }
  }
}

# ---------- office-hours schedule (non-prod) ----------

data "aws_iam_policy_document" "scheduler_assume" {
  count = var.office_hours_schedule ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count              = var.office_hours_schedule ? 1 : 0
  name               = "${local.node_name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume[0].json
  tags               = var.tags
}

data "aws_iam_policy_document" "scheduler" {
  count = var.office_hours_schedule ? 1 : 0
  statement {
    actions   = ["ec2:StartInstances", "ec2:StopInstances"]
    resources = [aws_instance.node.arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
  statement {
    actions   = ["kms:CreateGrant"]
    resources = [var.kms_key_arn]
    condition {
      test     = "Bool"
      variable = "kms:GrantIsForAWSResource"
      values   = ["true"]
    }
  }
}

resource "aws_iam_role_policy" "scheduler" {
  count  = var.office_hours_schedule ? 1 : 0
  name   = "start-stop-node"
  role   = aws_iam_role.scheduler[0].id
  policy = data.aws_iam_policy_document.scheduler[0].json
}

resource "aws_scheduler_schedule" "start" {
  count                        = var.office_hours_schedule ? 1 : 0
  name                         = "${local.node_name}-start"
  kms_key_arn                  = var.kms_key_arn
  schedule_expression          = "cron(0 8 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Kolkata"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = "arn:${local.arn}:scheduler:::aws-sdk:ec2:startInstances"
    role_arn = aws_iam_role.scheduler[0].arn
    input    = jsonencode({ InstanceIds = [aws_instance.node.id] })
  }
}

resource "aws_scheduler_schedule" "stop" {
  count                        = var.office_hours_schedule ? 1 : 0
  name                         = "${local.node_name}-stop"
  kms_key_arn                  = var.kms_key_arn
  schedule_expression          = "cron(0 20 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Kolkata"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = "arn:${local.arn}:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.scheduler[0].arn
    input    = jsonencode({ InstanceIds = [aws_instance.node.id] })
  }
}
