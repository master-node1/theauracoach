# ADR-007: AWS ap-south-1 on ECS Fargate, Terraform, GitHub Actions

Status: Proposed · 2026-10-11

## Context
India-first users, DPDP considerations, owner experience with AWS, Terraform, GitHub Actions and EKS (`eks-terraform-template`).

## Options Considered
EKS with Helm (reuse the-aura-lab patterns); ECS Fargate; Vercel + managed DB elsewhere.

## Decision
ECS Fargate for `api`, `worker`, `web` in `ap-south-1`, three environments (dev, staging, prod) in separate AWS accounts under AWS Organizations. Terraform modules per environment; GitHub Actions with OIDC to AWS (no long-lived keys). Mobile builds via EAS.

## Consequences
+ No cluster to operate for three containers; lower fixed cost than an EKS control plane per environment.
− Different from the-aura-lab's EKS/Helm pattern. If the owner prefers one platform, switching to EKS later only changes the deploy layer (images are the same).

## Alternatives Rejected
Vercel (data residency and split ops); EKS now (more ops than three services need).
