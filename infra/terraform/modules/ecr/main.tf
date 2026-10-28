# One private repository per deployable (service-catalog.md), immutable tags,
# scan on push, and a lifecycle that keeps the last 30 release images.

resource "aws_ecr_repository" "this" {
  for_each             = toset(var.repositories)
  name                 = "${var.repository_prefix}/${each.value}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.kms_key_arn
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Drop untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last ${var.keep_images} tagged images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.keep_images
        }
        action = { type = "expire" }
      },
    ]
  })
}

# Release promotion (TAC-37): prod copies the exact image that passed staging from this registry.
# The prod side still needs an identity policy allowing the pull (github-oidc module).
data "aws_iam_policy_document" "pull" {
  count = length(var.pull_account_ids) > 0 ? 1 : 0
  statement {
    sid     = "CrossAccountPull"
    actions = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer"]
    principals {
      type        = "AWS"
      identifiers = [for id in var.pull_account_ids : "arn:${data.aws_partition.current.partition}:iam::${id}:root"]
    }
  }
}

data "aws_partition" "current" {}

resource "aws_ecr_repository_policy" "pull" {
  for_each   = length(var.pull_account_ids) > 0 ? aws_ecr_repository.this : {}
  repository = each.value.name
  policy     = data.aws_iam_policy_document.pull[0].json
}
