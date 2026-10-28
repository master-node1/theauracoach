terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
  }

  # Values come from backend.hcl (see backend.hcl.example): terraform init -backend-config=backend.hcl
  backend "s3" {}
}

locals {
  default_tags = {
    Project    = "auracoach"
    Account    = local.account_label
    ManagedBy  = "terraform"
    Stack      = "platform"
    Repository = "master-node1/theauracoach"
    DataClass  = local.account_label == "prod" ? "personal" : "synthetic"
    CostCentre = "auracoach-beta"
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = local.default_tags
  }
}

# CloudFront certificates and WAF must live in us-east-1.
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = local.default_tags
  }
}

# Disaster-recovery copies (RDS snapshots, S3 replication).
provider "aws" {
  alias               = "dr"
  region              = var.dr_region
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = local.default_tags
  }
}
