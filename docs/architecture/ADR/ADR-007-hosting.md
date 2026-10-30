# ADR-007: Staged hosting on AWS ap-south-1: k3s on EC2 for beta, EKS for growth

Status: Accepted (product owner, 2026-10-12; written up 2026-10-27, TAC-4) · Supersedes the 2026-10-11 draft that put every environment on EKS from day one

## Context
Eight backend services plus the web app, India-first users (DPDP), and an owner who already runs EKS, a generic Helm chart (`infra/helm/aura-service`) installed by Terraform `helm_release`, and changed-service CI in `the-aura-lab` and `eks-terraform-template`.

The first version of this ADR put every environment on its own EKS cluster (3 AZs in prod, Karpenter, NAT per AZ, AWS Network Firewall). Priced at closed-beta traffic (about 200 users), that design costs about **$1,250/month in infrastructure** across dev, staging and prod, plus AI. The PRD target is infra ≤ USD 600/month at beta ([product requirements](../../requirements/product-requirements.md)). Beta load fits comfortably on one machine, so most of that spend buys headroom and availability we do not need yet. The full estimate is in the project's `analysis/monthly-cost-estimate.md`.

## Options Considered
1. EKS from day one (previous decision).
2. ECS Fargate per service.
3. k3s on EC2 for beta, moving to EKS when load or uptime needs it, with the same chart and pipeline.
4. A single VM running Docker Compose.

## Decision
Option 3: staged hosting in `ap-south-1`.

### Stage 1 (closed and open beta): k3s on EC2 Graviton

| | prod (`auracoach-prod` account) | non-prod (`auracoach-nonprod` account) |
|---|---|---|
| Compute | 1 × `t4g.xlarge` k3s server node (4 vCPU, 16 GiB), 50 GB gp3, EC2 auto-recovery alarm | 1 × `t4g.large` k3s server node (2 vCPU, 8 GiB), 50 GB gp3, stopped out of hours (Instance Scheduler: weekdays 08:00–20:00 IST) |
| Environments | prod | dev and staging as namespaces on the same node |
| k3s datastore | Embedded etcd (single member, `--cluster-init`), snapshots every 6 h to S3, 14 days kept | Same, 3 days kept |
| PostgreSQL | RDS PostgreSQL 16 `db.t4g.small` single-AZ, 50 GB gp3, PITR 14 days, weekly snapshot copy to `ap-southeast-1`; one database and one DB user per service (unchanged, [ADR-003](ADR-003-backend-data-stack.md)) | Postgres 16 StatefulSet per environment on the node (synthetic data) |
| Redis | ElastiCache Redis 7 `cache.t4g.micro`, single node (BullMQ, cache, Redis Streams) | Redis 7 StatefulSet per environment |
| Edge | CloudFront + WAF → k3s built-in Traefik ingress on the node (no ALB) | CloudFront → Traefik (no WAF) |
| Egress | Node in a public subnet with an Elastic IP (no NAT gateway); Route 53 Resolver DNS Firewall allow-list | Same |
| Unchanged | S3, Cognito, SES, ECR, Secrets Manager, KMS, CloudWatch, Grafana Cloud | Same |

Why each choice:
- **One node, not three.** Seven NestJS services, the gateway and the web app need about 5–7 GiB at beta traffic with one or two replicas each; `t4g.xlarge` leaves room for rolling updates and system pods. EC2 auto-recovery restarts the same instance (same EBS volume and IP) on host failure in a few minutes.
- **Embedded etcd rather than the default SQLite.** It gives `k3s etcd-snapshot` with S3 upload and lets us add server nodes later without migrating the datastore.
- **Managed RDS and ElastiCache in prod.** User data must survive losing the node, and both are cheap at these sizes. In non-prod, in-cluster containers are enough because the data is synthetic.
- **Traefik behind CloudFront.** k3s ships Traefik and ServiceLB, which bind ports 80/443 on the node. CloudFront terminates public TLS and holds WAF; the origin listens only on 443 with a cert-manager certificate (Let's Encrypt via Route 53 DNS-01), the security group admits only the CloudFront origin-facing managed prefix list, and Traefik rejects requests without the secret `X-Origin-Verify` header CloudFront adds. Traefik routes to `api-gateway` and `web` only, as the ALB did.
- **No NAT, DNS Firewall for egress.** A node with a public IP has direct egress, which removes the NAT gateway. Outbound domains are limited by a Route 53 Resolver DNS Firewall allow-list (about $2/month) instead of AWS Network Firewall (about $740/month). See [deployment architecture §3](../deployment-architecture.md#3-network).
- **Secrets without IRSA.** External Secrets Operator reads AWS Secrets Manager with the node's instance role, which may read only `auracoach/<env>/*`. Pods reach the instance metadata endpoint only where a NetworkPolicy allows it.

### Stage 2 (growth): Amazon EKS
The layout this ADR originally chose: EKS per environment, Graviton managed node groups with Karpenter, AWS Load Balancer Controller and ALB, IRSA role per service, RDS Multi-AZ, ElastiCache with a replica, 3 AZs in prod, NAT per AZ, and an egress firewall chosen at that time (DNS Firewall or AWS Network Firewall). Dev and staging can stay on the non-prod k3s node until staging needs to mirror prod.

Move prod to Stage 2 when **any** of these holds:

| Trigger | Threshold |
|---|---|
| Load | Prod node CPU or memory above 60% (7-day p95) after one vertical step to `t4g.2xlarge` |
| Users | More than about 5,000 monthly active users, or sustained API traffic above 50 requests/s |
| Uptime | The API availability SLO is raised above 99.5%, or single-node incidents and patch windows use more than half of the monthly error budget two months running |
| Security or compliance | An audit, customer or regulator requires per-service IAM identities or multi-AZ hosting |
| Team | More than one team deploys independently and needs separate node pools or quotas |

The migration is a platform change, not an application change: Terraform `platform` gains the EKS stack, the `service` stack points its Helm provider at the new cluster, services move one at a time behind CloudFront by switching the origin, and RDS is modified in place to Multi-AZ.

### What stays the same in both stages
- One generic Helm chart, `infra/helm/aura-service`, for every service. Following the-aura-lab convention, Kubernetes workloads are only ever deployed through that chart; no raw manifests or `kubernetes_*` workload resources. Cluster add-ons (Traefik config, cert-manager, External Secrets, system-upgrade-controller) are Helm releases too.
- One Helm release per service from `infra/helm/values`; a stage only changes cluster connection and a few values (replicas, autoscaling, service account annotations). The CD job runs the Helm CLI rather than Terraform `helm_release` ([ADR-010](ADR-010-cd-helm-cli.md)).
- GitHub Actions with OIDC (no static AWS keys) builds and deploys only changed services. In Stage 1 the k3s API is not internet-facing: the deploy job opens an SSM Session Manager port forward to port 6443 and runs Terraform through it.
- Secrets in AWS Secrets Manager, synced by External Secrets Operator.
- Default-deny NetworkPolicies (k3s ships an enforcing network policy controller), health probes, the nginx `api-gateway`, OpenTelemetry to Grafana Cloud.
- Mobile builds via EAS.

## Consequences

### Monthly cost (USD, ap-south-1 on-demand list prices, ±10%; GST extra)

| | Stage 1: k3s | Stage 2: EKS |
|---|---|---|
| prod infrastructure | ≈ 185 | ≈ 630 (no Network Firewall) |
| non-prod infrastructure (dev + staging) | ≈ 35 | ≈ 620 (two EKS clusters) |
| shared tools (EAS, app stores, Grafana, domain, state) | ≈ 56 | ≈ 56 |
| **Infrastructure total** | **≈ 275** | **≈ 1,250** |
| AI, prod (per-feature routing, see below) | ≈ 280 | ≈ 280 |
| AI, dev and staging | ≈ 55 | ≈ 55 |
| **Total** | **≈ 610** | **≈ 1,590** |

Stage 1 prod breakdown: EC2 `t4g.xlarge` 79, EBS 5, RDS `db.t4g.small` + 50 GB 35, ElastiCache micro 14, CloudFront + WAF 15, Secrets Manager + KMS 9, CloudWatch 8, Elastic IP 4, S3 / Route 53 / SES / ECR / DNS Firewall / data out 15. Non-prod: EC2 `t4g.large` at about 260 h/month 14, EBS 5, Elastic IP 4, CloudFront 2, secrets and logs 10. Stage 2 figures are the "recommended for beta" column of the cost estimate. AI at Opus 5.5 everywhere would be about $730/month in prod instead of $280; per-feature routing is recorded in the [AI coach LLD §2](../../modules/ai-coach/LLD.md).

### Benefits
+ Infrastructure falls from about $1,250 to about $275/month, inside the PRD target with room for AI.
+ The chart, Terraform service module, CI and service code are the same in both stages, so the move to EKS does not touch application code.
+ NetworkPolicies, External Secrets and Helm-only deploys keep the security model close to Stage 2.

### Trade-offs accepted for beta
− **Single-node prod.** A host failure costs a few minutes (auto-recovery); an instance that will not come back costs about an hour (rebuild from Terraform and restore the latest etcd snapshot; data is in RDS and ElastiCache). OS patching reboots the node in a weekly window (Sunday 03:00 IST). The 99.5% availability SLO allows about 3.6 hours a month.
− **Self-managed Kubernetes.** We upgrade k3s (system-upgrade-controller, one minor version at a time, staging first), patch the OS (SSM Patch Manager) and keep etcd snapshots tested in the quarterly DR drill.
− **No Karpenter or IRSA.** Scaling is vertical; HPA stays in the chart but has little room on one node. All pods that may call AWS share the instance role, so per-service least privilege is enforced by NetworkPolicy (who can reach the metadata endpoint) and by narrow role policies rather than separate identities. IRSA returns in Stage 2.
− **Single-AZ data stores.** RDS keeps PITR and cross-region copies; an AZ outage means restoring into another AZ (about an hour).
− **Dev and staging share a node and an account.** Weaker isolation between them than separate accounts; acceptable because both hold synthetic data only. Prod stays in its own account.
− **DNS Firewall, not packet inspection.** It blocks lookups of non-allowed domains but not connections to raw IP addresses; NetworkPolicy egress rules (only pods that need the internet may leave the cluster, and only on 443) cover that gap.

## Alternatives Rejected
- **EKS from day one:** about $975/month more for beta with no user-facing benefit at this load; kept as Stage 2.
- **ECS Fargate:** cheaper than EKS, but needs a different deployment model from the owner's Helm and Terraform tooling and would be thrown away at Stage 2.
- **Docker Compose on one VM:** cheapest, but no Helm chart, NetworkPolicies or rolling deploys, so the move to EKS would be a rewrite of the delivery pipeline.
- **Lambda:** cold starts for SSE and coach streaming, awkward for long-lived workers.
