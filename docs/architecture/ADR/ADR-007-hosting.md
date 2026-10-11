# ADR-007: AWS ap-south-1 on EKS with Helm, Terraform and GitHub Actions

Status: Proposed · 2026-10-11 (revised for microservices)

## Context
Eight backend services plus the web app, India-first users (DPDP), and an owner who already runs EKS, a generic Helm chart (`infra/helm/aura-service`) installed by Terraform `helm_release`, and changed-service CI in `the-aura-lab` and `eks-terraform-template`.

## Options Considered
ECS Fargate per service; EKS with one generic Helm chart; serverless (Lambda) per service.

## Decision
Amazon EKS in `ap-south-1` (managed node groups on Graviton, Karpenter for scaling), one generic Helm chart for every service, Terraform `helm_release` per service with `services/<name>.tfvars.json`, AWS Load Balancer Controller for the ALB, the nginx `api-gateway` service for routing. Separate AWS accounts for dev, staging and prod. GitHub Actions with OIDC builds and deploys only changed services, mirroring the-aura-lab pipeline. Mobile builds via EAS.

Following the-aura-lab convention: Kubernetes workloads are only ever deployed through the Helm chart; no raw manifests or `kubernetes_*` workload resources.

## Consequences
+ One platform and one chart for all services; reuse of existing templates and skills.
+ Fine-grained scaling (HPA per service), NetworkPolicies for service-to-service rules.
− EKS control plane cost per environment and more cluster operations than Fargate. Dev uses a single small node group; staging scales to zero nodes out of hours.

## Alternatives Rejected
ECS Fargate (fine for few services, but diverges from the owner's existing EKS/Helm tooling); Lambda (cold starts for SSE and coach streaming, awkward for long-lived workers).
