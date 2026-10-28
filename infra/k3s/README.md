# k3s platform (Stage 1)

Cluster add-ons for the Stage 1 k3s nodes ([ADR-007](../../docs/architecture/ADR/ADR-007-hosting.md)), as Helm values only. Nothing here is applied by hand: Terraform (TAC-36) installs them as `helm_release` resources in the order of `addons.yaml`, then the in-repo charts in `infra/helm`. CI renders and validates all of it (`tools/ci/helm-validate.sh --addons`).

| File | What |
|---|---|
| `addons.yaml` | Pinned k3s version and the add-on releases (chart, repository, version, namespace, values) |
| `traefik-config.yaml` | `HelmChartConfig` for k3s's bundled Traefik: HTTPS only, TLS 1.2+, JSON access logs without headers |
| `values/cert-manager.yaml` | Origin certificate issuer (Let's Encrypt, Route 53 DNS-01) |
| `values/external-secrets.yaml` | External Secrets Operator (AWS Secrets Manager) |
| `values/otel-collector.yaml` | One collector per node: OTLP from services and pod logs to Grafana Cloud |

Postgres and Redis for dev and staging are the in-repo `infra/helm/aura-datastores` chart (official `postgres` and `redis` images) rather than a third-party chart, so they meet the same restricted Pod Security and NetworkPolicy rules as the services.

How a deploy runs: [docs/operations/deployment.md](../../docs/operations/deployment.md).
