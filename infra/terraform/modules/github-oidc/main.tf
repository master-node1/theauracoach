# GitHub Actions OIDC (no static AWS keys). Two roles per account:
#   plan   - read-only, assumable from pull requests and main, for `terraform plan`;
#   deploy - assumable only from the named GitHub environments: pushes images to
#            ECR and opens the SSM port forward to the k3s API (ADR-007).

data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  arn          = data.aws_partition.current.partition
  account      = data.aws_caller_identity.current.account_id
  region       = data.aws_region.current.name
  provider_url = "token.actions.githubusercontent.com"
  provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:${local.arn}:iam::${local.account}:oidc-provider/${local.provider_url}"
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_oidc_provider ? 1 : 0
  url            = "https://${local.provider_url}"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates GitHub's certificate itself; the thumbprint is required by the API only.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  tags            = var.tags
}

# ---------- plan role ----------

data "aws_iam_policy_document" "plan_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "${local.provider_url}:sub"
      values = [
        "repo:${var.github_repository}:pull_request",
        "repo:${var.github_repository}:ref:refs/heads/main",
      ]
    }
  }
}

resource "aws_iam_role" "plan" {
  name                 = "${var.name_prefix}-github-plan"
  assume_role_policy   = data.aws_iam_policy_document.plan_assume.json
  max_session_duration = 3600
  tags                 = var.tags
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:${local.arn}:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "state" {
  statement {
    sid       = "StateBucketList"
    actions   = ["s3:ListBucket"]
    resources = ["arn:${local.arn}:s3:::${var.state_bucket}"]
  }
  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["arn:${local.arn}:s3:::${var.state_bucket}/*"]
  }
  statement {
    sid       = "StateLock"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:DescribeTable"]
    resources = ["arn:${local.arn}:dynamodb:${local.region}:${local.account}:table/${var.lock_table}"]
  }
  statement {
    sid       = "StateKey"
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [var.state_kms_key_arn]
  }
}

# Refreshing the few secret versions Terraform manages needs their values; the
# same values are already in the state this role reads.
data "aws_iam_policy_document" "plan_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "arn:${local.arn}:secretsmanager:${local.region}:${local.account}:secret:auracoach/*/redis-*",
      "arn:${local.arn}:secretsmanager:${local.region}:${local.account}:secret:auracoach/*/web/oidc-*",
      "arn:${local.arn}:secretsmanager:${local.region}:${local.account}:secret:auracoach/*/edge/origin-verify-*",
    ]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "plan_secrets" {
  name   = "managed-secret-values"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_secrets.json
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "terraform-state"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.state.json
}

# ---------- deploy role ----------

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.provider_url}:sub"
      values   = [for e in var.deploy_environments : "repo:${var.github_repository}:environment:${e}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name_prefix}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.deploy_assume.json
  max_session_duration = 3600
  tags                 = var.tags
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = var.ecr_repository_arns
  }

  statement {
    sid       = "EcrKey"
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [var.kms_key_arn]
  }

  statement {
    sid     = "PortForwardToK3sApi"
    actions = ["ssm:StartSession"]
    resources = [
      var.k3s_instance_arn,
      "arn:${local.arn}:ssm:${local.region}::document/AWS-StartPortForwardingSession",
    ]
  }

  statement {
    sid       = "EndOwnSessions"
    actions   = ["ssm:TerminateSession", "ssm:ResumeSession"]
    resources = ["arn:${local.arn}:ssm:${local.region}:${local.account}:session/*"]
  }

  statement {
    sid       = "DescribeForSsm"
    actions   = ["ec2:DescribeInstances", "ssm:DescribeInstanceInformation"]
    resources = ["*"]
  }

  # The service stack needs the kubeconfig the node publishes to SSM Parameter Store.
  statement {
    sid       = "ReadKubeconfig"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:${local.arn}:ssm:${local.region}:${local.account}:parameter/${var.name_prefix}/k3s/*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

resource "aws_iam_role_policy" "deploy_state" {
  name   = "terraform-state"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.state.json
}
