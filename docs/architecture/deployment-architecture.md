# Deployment Architecture

## 1. Environments

| Env | AWS account | Purpose | Data | Scale |
|---|---|---|---|---|
| local | — | Docker Compose: Postgres 16, Redis 7, MinIO, Mailpit, cognito-local stub | Seed + synthetic | — |
| dev | `auracoach-dev` | Integration of `main`, preview of features | Synthetic | 1 task each, single-AZ RDS |
| staging | `auracoach-staging` | Release candidates, E2E, load, DAST | Synthetic, prod-like volume | Mirrors prod at 50% |
| prod | `auracoach-prod` | Users | Real | API 2–10 tasks, worker 1–6, RDS Multi-AZ |

Mobile: EAS channels `development`, `preview` (staging API), `production`. OTA updates (EAS Update) only for JS changes compatible with the installed runtime version.

## 2. Network

```mermaid
flowchart TB
  inet((Internet)) --> cf[CloudFront + WAF]
  cf --> alb[ALB in public subnets]
  subgraph vpc["VPC 10.x.0.0/16, 3 AZs"]
    alb --> webt[web tasks]
    alb --> apit[api tasks]
    wkt[worker tasks]
    subgraph priv["private subnets"]
      webt
      apit
      wkt
    end
    subgraph iso["isolated subnets"]
      rds[(RDS)]
      redis[(Redis)]
    end
    apit --> rds & redis
    wkt --> rds & redis
    nat[NAT gateway] --> inet
    apit --> nat
    wkt --> nat
  end
  apit -. VPC endpoints .-> s3[(S3)] & sm[Secrets Manager]
```

Egress to AI provider, Open Food Facts, Expo Push and SES via NAT with an egress allow-list (AWS Network Firewall in prod; security-group + DNS firewall in lower envs).

## 3. CI/CD (GitHub Actions)

```mermaid
flowchart LR
  pr[Pull request] --> q[lint · typecheck · unit · contract]
  q --> it[integration: Testcontainers Postgres/Redis]
  it --> sec[CodeQL · Semgrep · gitleaks · pnpm audit · Trivy]
  sec --> prev[build images + Terraform plan dev]
  main[Merge to main] --> bd[build + push ECR, sign with cosign]
  bd --> dd[deploy dev: migrate → rolling ECS]
  dd --> e2e[E2E Playwright web + Maestro mobile on dev]
  tag[Release tag] --> st[deploy staging] --> ld[k6 load + ZAP + AI eval gate]
  ld --> appr{manual approval}
  appr --> pd[deploy prod: migrate → blue/green via CodeDeploy]
```

- Turborepo affected-graph runs only what changed.
- Migrations run as a one-off ECS task before the new task set; only **expand** migrations deploy with code; **contract** migrations ship one release later.
- Rollback: CodeDeploy blue/green reverts traffic in < 5 min; DB rollbacks avoided by expand/contract; feature flags (Unleash self-hosted or DB-backed flags) for risky features.
- Mobile: EAS Build on tag → TestFlight / Play internal track → staged rollout 10% → 50% → 100%.

## 4. Infrastructure as code

`infra/terraform/` with modules `network`, `ecs-service`, `rds`, `redis`, `s3-cdn`, `cognito`, `observability`, `budgets`, and `envs/{dev,staging,prod}`. State in S3 with DynamoDB locking, one state per env. Reuse patterns from `eks-terraform-template` where applicable (VPC module, tagging).

## 5. Backup and disaster recovery

| Asset | Backup | RPO | RTO |
|---|---|---|---|
| RDS | Automated daily + PITR 14 days; weekly cross-region copy to `ap-southeast-1` | 5 min (PITR) / 24 h (region) | 1 h / 4 h |
| S3 user media | Versioning + cross-region replication | 15 min | 4 h |
| Redis | Not backed up (cache + queues reconstructable; jobs idempotent) | — | 15 min |
| Config | Terraform + Git | 0 | 1 h |

DR drill each quarter: restore staging from prod-snapshot-equivalent synthetic dataset and measure.

## 6. Operations docs (created in Phase 4)

`docs/operations/local-development.md`, `deployment.md`, `monitoring.md`, `troubleshooting.md`, `incident-response.md` are written alongside the foundation code so they describe real commands.
