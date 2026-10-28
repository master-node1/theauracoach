# Infrastructure (Terraform, Stage 1)

The AWS platform for beta is defined in [`infra/terraform`](../../infra/terraform) ([TAC-36](https://harisireddi7776.atlassian.net/browse/TAC-36)), following [ADR-007](../architecture/ADR/ADR-007-hosting.md) Stage 1: one k3s node on EC2 Graviton per account, RDS and ElastiCache in prod, CloudFront in front, no NAT gateway. **Nothing has been applied.** CI only formats, validates and lints it; the owner applies it with the steps below once the AWS accounts exist ([TAC-44](https://harisireddi7776.atlassian.net/browse/TAC-44)).

## Layout

| Path | What it is |
|---|---|
| `bootstrap/` | State backend per account: KMS key, versioned S3 bucket, DynamoDB lock table. Applied once with local state. |
| `envs/prod/` | `platform` stack for the `auracoach-prod` account. |
| `envs/nonprod/` | `platform` stack for the `auracoach-nonprod` account: dev and staging as namespaces on one node, Postgres and Redis as StatefulSets (no RDS or ElastiCache), node stopped out of hours, no WAF. |
| `modules/` | `kms`, `network`, `k3s-node`, `rds`, `redis`, `storage`, `cognito`, `ses`, `edge`, `ecr`, `secrets`, `appconfig`, `dns-firewall`, `observability`, `github-oidc`. |
| `scripts/bootstrap-secrets.sh` | Fills the Secrets Manager entries Terraform leaves empty, in the shape the Helm charts read: per-service `DATABASE_URL` / `MIGRATION_DATABASE_URL` / `REDIS_URL`, `shared`, `web`, and non-prod `datastores`. In prod it also creates one database, an owner role (DDL, migrations) and an app role (DML only) per service on RDS. |

The `service` stack (one `helm_release` per service, [deployment architecture §5](../architecture/deployment-architecture.md#5-infrastructure-as-code)) comes with the CD pipeline ([TAC-37](https://harisireddi7776.atlassian.net/browse/TAC-37)); the chart and cluster add-ons are [TAC-35](https://harisireddi7776.atlassian.net/browse/TAC-35).

## What each account gets

| | prod | nonprod |
|---|---|---|
| Network | VPC `10.20.0.0/16`: one public subnet (node, Elastic IP), two isolated subnets (no internet route), S3 gateway endpoint, rejected-traffic flow logs | VPC `10.10.0.0/16`, same shape |
| k3s node | `t4g.xlarge`, AL2023 arm64, 50 GB gp3 (KMS), IMDSv2 hop limit 2, SSM only (no SSH, no public 6443), auto-recover and reboot alarms, patch window Sunday 03:00 IST, embedded etcd snapshots every 6 h to S3 (14 days) | `t4g.large`, same, snapshots kept 3 days, EventBridge Scheduler starts it 08:00 and stops it 20:00 IST on weekdays |
| Node security group | In: 443 from the CloudFront origin-facing prefix list only. Out: 443 anywhere (narrowed by DNS Firewall and NetworkPolicies), 53 to the VPC resolver, 5432 and 6379 to the VPC | Same |
| Data | RDS PostgreSQL 16 `db.t4g.small` single-AZ, gp3 50 GB (autoscaling to 200), `rds.force_ssl`, PITR 14 days, master password managed by RDS, weekly AWS Backup copy to `ap-southeast-1`; ElastiCache Redis 7 `cache.t4g.micro` with TLS, AUTH, `noeviction`, daily snapshot | In-cluster (TAC-35) |
| Storage | `user-private` (exports expire after 7 days, replicated to `ap-southeast-1`), `content-media` (served at `/media/*` through CloudFront origin access control), `backups` (etcd), `logs` (S3 access logs). All versioned, TLS-only, public access blocked, SSE-KMS except `logs` | Same, no replication |
| Edge | CloudFront (`app.` and `api.` hosts, HTTP/2 and 3, ACM certificate in us-east-1, security headers) → `origin.<domain>` on 443 with the secret `X-Origin-Verify` header. WAF: IP reputation, common rules (body size rule counted, not blocked, for coach and photo uploads), known bad inputs, SQLi, 2,000 requests per IP per 5 min, 100 per IP per 5 min on `/api/auth/*` | `app.dev.`, `api.dev.`, `app.staging.`, `api.staging.` on one distribution, no WAF |
| Identity | Cognito pool (Plus tier for threat protection, enforced), email sign-in with code verification, password ≥ 12 with upper, lower and digit, TOTP MFA optional (required for admin roles by the API), groups `user`, `content_editor`, `nutrition_reviewer`, `safety_reviewer`, `ai_admin`, `support`, `owner`, Google and Apple when their variables are set, pre-token-generation Lambda (V2) adding `email` to access tokens. Clients: web BFF (confidential) and mobile (public), both with code flow and `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_USER_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH` for the in-app email flows ([TAC-8](https://harisireddi7776.atlassian.net/browse/TAC-8)); access and ID tokens 15 min, refresh 30 days, user-existence errors hidden | One pool per environment (`auracoach-dev`, `auracoach-staging`), threat protection in audit mode, `http://localhost:3100` also allowed on dev |
| Email | SES domain identity with DKIM, MAIL FROM `mail.<domain>`, DMARC record (optional), configuration set with TLS required and bounce/complaint suppression | Same on the nonprod domain |
| Images | ECR repository per deployable (`auracoach/<name>`), immutable tags, scan on push, last 30 kept | Same |
| Secrets | Containers only, filled by `bootstrap-secrets.sh` and the owner: `auracoach/prod/<deployable>`, `auracoach/prod/shared`, `auracoach/prod/platform` (Grafana Cloud credentials). Terraform itself writes only `auracoach/prod/redis` and `auracoach/prod/edge/origin-verify`, whose values it has to know | Same for `dev` and `staging`, plus `auracoach/<env>/datastores`, `auracoach/nonprod/platform` and `auracoach/nonprod/edge/origin-verify` |
| Feature flags | AppConfig application `auracoach`, environment `prod`, hosted freeform profile `flags` (the names the Helm values use), 10-minute linear deployment strategy ([TAC-10](https://harisireddi7776.atlassian.net/browse/TAC-10)) | Environments `dev` and `staging` |
| Egress | Route 53 Resolver DNS Firewall: allow-list (AWS, k3s and chart sources, Let's Encrypt, Anthropic, Open Food Facts, Expo, Grafana Cloud, Sentry), everything else NXDOMAIN, query logs 30 days | Same |
| Alerts and cost | SNS topic (KMS) with email subscribers, monthly budget $220 (80% actual, 100% forecast), root console sign-in alert, RDS, Redis and node alarms | Budget $50 |
| CI access | GitHub OIDC provider; `auracoach-prod-github-plan` (read-only, PRs and `main`) and `auracoach-prod-github-deploy` (GitHub environment `prod` only: ECR push, SSM port forward to the node, read the kubeconfig parameter) | Deploy role for environments `dev` and `staging` |

The node instance role is shared by every pod that may reach the metadata endpoint (NetworkPolicy decides which), so each permission is scoped to this account's resources: ECR repositories, the two app buckets, the etcd prefix, SES identity, Cognito pools, AppConfig application, and Route 53 DNS-01 records for cert-manager. It cannot read secrets itself. External Secrets assumes one role per environment (`auracoach-<account>-secrets-<env>`, reading only `auracoach/<env>/*`) and a cluster role (`auracoach-<account>-secrets-platform`, reading only `auracoach/<account>/platform`), so dev cannot read staging's secrets on the shared node.

At first boot, cloud-init also writes `infra/k3s/traefik-config.yaml` (TAC-35) into `/var/lib/rancher/k3s/server/manifests` so k3s configures its bundled Traefik. The pinned k3s version (`v1.36.5+k3s1`) matches `infra/k3s/addons.yaml`.

## Cost check

Infracost needs an API key, so it is not part of CI yet. This is a resource-by-resource estimate at ap-south-1 on-demand list prices (USD per month, about 200 beta users, GST extra), against the ADR-007 Stage 1 figures:

| prod | ADR-007 | This code | Notes |
|---|---|---|---|
| EC2 `t4g.xlarge` + 50 GB gp3 | 84 | 84 | |
| RDS `db.t4g.small` + 50 GB gp3, PI 7 days (free) | 35 | 35 | Enhanced monitoring logs inside CloudWatch below |
| ElastiCache `cache.t4g.micro` | 14 | 14 | |
| CloudFront + WAF (ACL, 7 rules, requests) | 15 | 15 | |
| Secrets Manager (13 secrets) + KMS (3 keys) | 9 | 9 | |
| CloudWatch (alarms, logs, flow and query logs) | 8 | 9 | Flow logs cover rejected traffic only |
| Elastic IP | 4 | 4 | |
| S3, Route 53, SES, ECR, DNS Firewall, data out | 15 | 15 | |
| Cognito Plus tier (200 MAU × $0.02) | — | 4 | Needed for enforced threat protection |
| AWS Backup cross-region copy + S3 replication | — | 2 | Small at beta data volumes |
| **Total** | **≈ 185** | **≈ 191** | +3%, inside the ±15% acceptance band |

| nonprod | ADR-007 | This code |
|---|---|---|
| EC2 `t4g.large` at ≈ 260 h/month + 50 GB gp3 | 19 | 19 |
| Elastic IP (charged while stopped too) | 4 | 4 |
| CloudFront | 2 | 2 |
| Secrets (21) + KMS + logs | 10 | 10 |
| **Total** | **≈ 35** | **≈ 35** |

Add the state backend (≈ $1 per account) and shared tools from ADR-007. To get the machine-checked figure, run `infracost breakdown --path infra/terraform/envs/prod` with an `INFRACOST_API_KEY`; usage-based lines (requests, data out) need an `infracost-usage.yml`.

## Applying it (owner steps)

Run every command from a machine with Terraform ≥ 1.9, the AWS CLI with the Session Manager plugin, `psql` and `jq`, signed in to the target account with an administrator role. Do nonprod first.

1. **Accounts.** Create `auracoach-prod` and `auracoach-nonprod` in AWS Organizations, enable IAM Identity Center for sign-in, and turn on Cost Explorer. Note both account IDs.
2. **DNS.** Register the domain (out of scope for this ticket). Create a public hosted zone for the apex in the prod account and one for `test.<domain>` (or any subdomain) in the nonprod account, and add the nonprod zone's NS records to the prod zone. ACM and SES validate through these zones, so `apply` waits until they resolve.
3. **State backend**, once per account:
   ```sh
   cd infra/terraform/bootstrap
   terraform init
   terraform apply -var account_label=nonprod   # or prod
   ```
   Keep the resulting local `terraform.tfstate` somewhere safe (it only describes the bucket and table).
4. **Configure the stack.** In `envs/<account>/`, copy `backend.hcl.example` to `backend.hcl` and `terraform.tfvars.example` to `terraform.tfvars`, and fill them in from the bootstrap outputs and step 2. Both files are git-ignored. Sensitive values go in the environment only: `export TF_VAR_google_client_secret=…`, `export TF_VAR_apple_private_key="$(cat AuthKey.p8)"`.
5. **Federation (optional at first).** For Google, create an OAuth client with redirect URI `https://auracoach-<env>.auth.ap-south-1.amazoncognito.com/oauth2/idpresponse`; for Apple, a Services ID, key and team ID with the same return URL. Leave the variables empty to apply without them and re-apply later.
6. **Apply.**
   ```sh
   cd infra/terraform/envs/nonprod
   terraform init -backend-config=backend.hcl
   terraform plan -out=tfplan
   terraform apply tfplan
   ```
   Then confirm the SNS subscription email each alert address receives.
7. **SES production access.** New accounts are in the SES sandbox, which only delivers to verified addresses, so Cognito verification and reset emails would not reach real users. Request production access for ap-south-1 in each account (Support case, use case "transactional account emails"). Until then, verify test addresses in the SES console.
8. **Secrets.** Run the bootstrap script once per environment. It generates `INTERNAL_TOKEN_SECRET` and `SESSION_SECRET`, copies the web client secret from Cognito, and writes the service URLs. For prod, first open a port forward to RDS through the node:
   ```sh
   aws ssm start-session --target "$(terraform output -raw k3s_instance_id)" \
     --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters host="$(terraform output -raw rds_endpoint)",portNumber=5432,localPortNumber=15432
   # in a second terminal
   RDS_ENDPOINT=$(terraform output -raw rds_endpoint) \
   MASTER_SECRET_ARN=$(terraform output -raw rds_master_secret_arn) \
   REDIS_SECRET_ARN=$(terraform output -raw redis_secret_arn) \
   USER_POOL_ID=… WEB_CLIENT_ID=… \
     ../../scripts/bootstrap-secrets.sh prod
   ```
   For nonprod, run `USER_POOL_ID=… WEB_CLIENT_ID=… ../../scripts/bootstrap-secrets.sh dev` and then the same for `staging`, using the `oidc` output of each environment. No port forward is needed, because the URLs point at the in-cluster data stores.
9. **Application secrets.** Add the remaining keys each service needs (for example the AI provider key for `coach-service`, and the Grafana Cloud credentials in `auracoach/<account>/platform`) to `auracoach/<env>/<service>` with `aws secretsmanager put-secret-value`; the Helm values in `infra/helm` list them per service.
10. **Cluster access check.**
    ```sh
    aws ssm start-session --target "$(terraform output -raw k3s_instance_id)" \
      --document-name AWS-StartPortForwardingSession \
      --parameters portNumber=6443,localPortNumber=6443
    aws ssm get-parameter --with-decryption --name /auracoach-<account>/k3s/kubeconfig \
      --query Parameter.Value --output text > ~/.kube/auracoach-<account>
    KUBECONFIG=~/.kube/auracoach-<account> kubectl get nodes
    ```
    Then install the cluster add-ons from `infra/k3s` (TAC-35), including cert-manager with the Route 53 DNS-01 issuer for `origin.<domain>` and the Traefik middleware that requires `X-Origin-Verify` (value in `auracoach/<account>/edge/origin-verify`, or `auracoach/prod/edge/origin-verify` in prod).
11. **GitHub.** Create environments `dev`, `staging` and `prod` (prod with required reviewers). Set the `github_roles` outputs as `AWS_DEPLOY_ROLE_ARN` per environment, and the repository variables `AWS_PLAN_ROLE_ARN_PROD` / `_NONPROD`, `TF_BACKEND_HCL_PROD` / `_NONPROD` and `TF_VARS_PROD` / `_NONPROD` (contents of `backend.hcl` and `terraform.tfvars`, no secrets) so the `Terraform` workflow starts running `plan`. If an account already has a GitHub OIDC provider, set `create_github_oidc_provider = false`.
12. **Deploy inputs.** The `oidc` output gives the issuer, JWKS URL, hosted UI URL, `IDENTITY_ENDPOINT` and client IDs. The `helm_inputs` output gives the image registry, the secrets role ARNs, the origin host, the hosted zone and, in prod, the RDS and ElastiCache subnet CIDRs. The CD pipeline ([TAC-37](https://harisireddi7776.atlassian.net/browse/TAC-37)) passes these to `infra/helm`, as listed in deployment.md §2. Use the `appconfig` output for the flag client.

## Operating it

- **Rebuild the node** (host lost, new AMI, k3s reinstall): `terraform apply -replace=module.k3s_node.aws_instance.node`. The Elastic IP and DNS follow. Restore cluster state from the newest snapshot under `s3://<backups bucket>/k3s-etcd/<node>/` with `k3s server --cluster-reset --etcd-s3 --cluster-reset-restore-path=<snapshot>` (the S3 settings are already in `/etc/rancher/k3s/config.yaml`). Prod data is in RDS and ElastiCache, so nothing else is lost. The AMI and user data are ignored on normal plans so the node is only replaced on purpose.
- **Rotate the origin header.** `terraform apply -replace=module.edge.random_password.origin_verify`, then let External Secrets refresh the Traefik middleware; requests fail with 403 for up to the refresh interval, so do it in the patch window.
- **Rotate generated secrets.** Re-run the bootstrap script with `ROTATE=1`. This replaces the database passwords, `INTERNAL_TOKEN_SECRET` and `SESSION_SECRET`. Then restart the affected pods.
- **Watch the DNS Firewall** for a week after go-live: if a needed domain is blocked, add it to `allowed_domains` in `modules/dns-firewall`. Setting `block_mode = false` switches the rule to alert-only.

## Known gaps (accepted for beta)

| Gap | Why | Follow-up |
|---|---|---|
| CloudFront standard access logs off | Legacy logging needs ACL-enabled buckets; WAF logs cover prod requests | TAC-41 decides on real-time logs |
| WAF log group not encrypted with the platform key | It lives in us-east-1 where that key does not exist; auth and cookie headers are redacted | Add a us-east-1 key if an audit asks |
| Single-AZ RDS and Redis, single node | ADR-007 Stage 1 trade-offs | Stage 2 triggers in ADR-007 |
| Secret rotation by runbook, not Lambda | Few static secrets at beta | Stage 2 |
| One Redis AUTH token, not a Redis ACL user per service | ElastiCache RBAC users per service add a user group to manage | Before Stage 2 |
| Cluster add-ons (`infra/k3s/addons.yaml`) and the `service` stack are not Terraform `helm_release`s yet | They need the Helm provider pointed at the cluster through the SSM port forward, which belongs with the deploy pipeline | [TAC-37](https://harisireddi7776.atlassian.net/browse/TAC-37) |
| The Redis AUTH token, CloudFront origin header and Cognito client secret are in Terraform state | Terraform must know them to configure the resources; state is SSE-KMS and versioned | — |
| Log groups kept 30–90 days, not a year | Cost; no compliance requirement yet | TAC-41 |

All checkov suppressions are inline (`#checkov:skip=<id>:<reason>`) next to the resource they apply to.
