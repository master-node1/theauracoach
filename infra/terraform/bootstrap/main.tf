# Terraform state backend for one AWS account: a versioned, KMS-encrypted S3
# bucket and a DynamoDB lock table. Apply once per account with local state
# (runbook step 2); every other stack then uses this backend.

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "auracoach"
      Account   = var.account_label
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

variable "region" {
  description = "Region of the state bucket."
  type        = string
  default     = "ap-south-1"
}

variable "account_label" {
  description = "prod or nonprod."
  type        = string
  validation {
    condition     = contains(["prod", "nonprod"], var.account_label)
    error_message = "account_label must be prod or nonprod."
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "auracoach-${var.account_label}-tfstate-${data.aws_caller_identity.current.account_id}"
}

data "aws_iam_policy_document" "state_key" {
  #checkov:skip=CKV_AWS_109:Key policy: "*" means this key
  #checkov:skip=CKV_AWS_111:Key policy: "*" means this key
  #checkov:skip=CKV_AWS_356:Key policy: "*" means this key
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_kms_key" "state" {
  description             = "Terraform state for auracoach-${var.account_label}"
  policy                  = data.aws_iam_policy_document.state_key.json
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "state" {
  name          = "alias/auracoach-${var.account_label}-tfstate"
  target_key_id = aws_kms_key.state.key_id
}

resource "aws_s3_bucket" "state" {
  #checkov:skip=CKV_AWS_144:State is versioned; replication is not needed for beta
  #checkov:skip=CKV2_AWS_62:No consumers for bucket events
  #checkov:skip=CKV_AWS_18:Created before any log bucket exists; CloudTrail data events can cover it
  bucket = local.name
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "old-state-versions"
    status = "Enabled"
    filter {
      prefix = ""
    }
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "state" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json
}

resource "aws_dynamodb_table" "lock" {
  name         = "auracoach-${var.account_label}-tflock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.state.arn
  }

  deletion_protection_enabled = true
}

output "state_bucket" {
  description = "Put in backend.hcl as bucket."
  value       = aws_s3_bucket.state.bucket
}

output "lock_table" {
  description = "Put in backend.hcl as dynamodb_table."
  value       = aws_dynamodb_table.lock.name
}

output "state_kms_key_arn" {
  description = "Put in backend.hcl as kms_key_id."
  value       = aws_kms_key.state.arn
}
