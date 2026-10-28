terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.95"
      configuration_aliases = [aws.us_east_1]
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
