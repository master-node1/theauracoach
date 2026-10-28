# ADR-010: Continuous delivery deploys with the Helm CLI from GitHub Actions, not Terraform `helm_release`

Status: Accepted (autonomy mode, 2026-10-28, [TAC-37](https://harisireddi7776.atlassian.net/browse/TAC-37)) · Amends [ADR-007](ADR-007-hosting.md) and [deployment architecture §4–5](../deployment-architecture.md#4-cicd-github-actions), which said the deploy job runs a Terraform `service` stack of `helm_release` resources

## Context
Every merge to main builds the images of the deployables it changed and deploys them to dev; a release tag deploys to staging and then prod (ADR-007: changed services only). The charts and values are in `infra/helm` (TAC-35) and the AWS platform in `infra/terraform` (TAC-36). Terraform's outputs are the deploy inputs (registry, Cognito, origin host, subnet CIDRs); values live in `infra/helm/values`, not in tfvars.

A deploy needs: one release per deployable and environment (9 × 3), an image tag that changes on most merges, migrations as Helm hooks, `--atomic` rollback, a quick manual rollback, and a cluster API that is reachable only through an SSM port forward.

## Options Considered
1. **Terraform `service` stack**, one `helm_release` per deployable, applied by the CD job through the Helm provider.
2. **Helm CLI** in the CD job: `helm upgrade --install --atomic` per changed deployable, with the deploy inputs read from the account stack's Terraform outputs.
3. **GitOps** (Argo CD or Flux in the cluster, CD only bumps image tags in Git).

## Decision
Option 2.
- `tools/deploy/helm-deploy.sh` renders exactly the values chain CI validates (`common.yaml`, `env/<env>.yaml`, `<deployable>.yaml`, deploy inputs) and runs `helm upgrade --install --atomic --wait` for services, then `api-gateway`, then `web`.
- Deploy inputs come from `terraform output -json` of `infra/terraform/envs/<account>` (`tools/deploy/deploy-inputs.mjs`); Terraform stays the single source for them and no values file holds an account-specific value. The origin header is the only secret input; the job reads it from Secrets Manager and passes it in a temporary values file.
- Cluster add-ons and `aura-platform` are installed the same way by `tools/deploy/install-platform.sh` (the *Cluster platform* workflow), in the order of `infra/k3s/addons.yaml`.
- The Helm release history is the deploy record: `helm rollback` (the *Rollback* workflow) undoes a release in seconds.

## Consequences
+ One state for releases (Helm's), not Helm's plus Terraform's; no 27 Terraform states or one big state whose plan touches every service on each merge.
+ Deploying a changed service is one Helm command that is easy to read in a job log and to repeat by hand from an operator machine.
+ Stage 2 (EKS) changes only how the job reaches the API (and adds `values/stage/eks.yaml`), as before.
− Drift between what is running and Git is not shown by a `terraform plan`. `helm diff` or a GitOps controller can add that later (Option 3 is the natural Stage 2 step).
− The deploy role needs read access to the Terraform state of its account (it already has it for the state lock) and to the origin header secret.

## Alternatives Rejected
Terraform `service` stack (slow plans over every release, image tags as Terraform variables, two sources of release state, awkward rollback); GitOps now (another controller on a small node, and Git write-back from CI; reconsider with EKS).
