# Deployment

How AuraCoach would be deployed to the Stage 1 k3s nodes ([ADR-007](../architecture/ADR/ADR-007-hosting.md)) with the Helm charts in `infra/helm` ([TAC-35](https://harisireddi7776.atlassian.net/browse/TAC-35)). **Nothing here has been run against a cluster.** The commands document what Terraform's `helm_release` resources ([TAC-36](https://harisireddi7776.atlassian.net/browse/TAC-36)) and the CD workflow ([TAC-37](https://harisireddi7776.atlassian.net/browse/TAC-37)) will do once the owner provides AWS accounts (TAC-44). CI only lints, renders and validates.

Layout and network design: [deployment architecture](../architecture/deployment-architecture.md). Who may call whom: [service catalog §4](../architecture/service-catalog.md#4-allowed-synchronous-dependencies).

## 1. What gets installed, in order

| # | Release | Chart | Namespace | Per |
|---|---|---|---|---|
| 1 | Traefik config | k3s bundled Traefik, configured by `infra/k3s/traefik-config.yaml` (placed by cloud-init) | `kube-system` | cluster |
| 2 | `cert-manager`, `external-secrets`, `otel-collector` | upstream charts, pinned in `infra/k3s/addons.yaml`, values in `infra/k3s/values/` | `aura-system` | cluster |
| 3 | `platform` | `infra/helm/aura-platform` with `values-nonprod.yaml` or `values-prod.yaml` | `aura-system` | cluster |
| 4 | `datastores-<env>` | `infra/helm/aura-datastores` (dev and staging only) | `<env>-aura-data` | non-prod environment |
| 5 | `<deployable>` | `infra/helm/aura-service` | `[<env>-]aura-services` or `[<env>-]aura-edge` | deployable × environment |

`aura-platform` creates each environment's namespaces with the **restricted** Pod Security Standard, a default-deny NetworkPolicy plus a DNS allowance in each, a `SecretStore` per namespace, the origin certificate for Traefik and the Let's Encrypt `ClusterIssuer`. Prod has `aura-edge` and `aura-services`; the non-prod node has `dev-` and `staging-` copies of those plus `<env>-aura-data`.

The nine deployables are `api-gateway`, `web` and the seven NestJS services. Each NestJS service release has:

| Object | Notes |
|---|---|
| `<name>-http` Deployment, Service, PDB (2+ replicas) | Probes: startup and liveness on `/health/live`, readiness on `/health/ready` (database, Redis). Rolling update with `maxUnavailable: 0` |
| `<name>-worker` Deployment | `node dist/main.worker.js`: outbox relay, stream consumers, jobs. No HTTP server, so no probes; a crash exits and restarts the pod |
| `<name>-migrate` Job (pre-install and pre-upgrade hook) | `prisma migrate deploy` with the migration user. Brings its own ServiceAccount, NetworkPolicy (Postgres only) and ExternalSecret as earlier hooks, because hooks run before the release's normal objects exist |
| ConfigMap `<name>-env`, ExternalSecret `<name>-env` | Environment for both deployments (§3) |
| NetworkPolicies `<name>-ingress`, `<name>-egress` | Generated from the call graph (§4) |
| ServiceAccount | No API token mounted; Stage 2 adds the IRSA annotation |

Every container runs as non-root with a read-only root filesystem, no capabilities, no privilege escalation and the `RuntimeDefault` seccomp profile; `/tmp` (and for nginx and Next.js their cache paths) are `emptyDir` volumes.

## 2. Values

A release is rendered from these files, later ones winning:

1. `infra/helm/aura-service/values.yaml`: chart defaults, documented inline.
2. `infra/helm/values/common.yaml`: the deployables, their namespaces and ports, and `global.callGraph`.
3. `infra/helm/values/env/<env>.yaml`: replicas, sizing, Secrets Manager prefix, where Postgres and Redis are.
4. `infra/helm/values/<deployable>.yaml`: kind, image, secrets it reads, internet and AWS access, ingress.
5. `infra/helm/values/stage/eks.yaml`: Stage 2 only (ALB ingress, HPA on, zone spread, no metadata access).
6. Deploy inputs from Terraform (below).

No values file contains a secret; CI fails if one does (§6).

### Deploy inputs

Terraform passes these from its outputs. `infra/helm/ci/*.yaml` holds fake examples used only to render in CI.

| Input | Chart | Source |
|---|---|---|
| `image.tag` | aura-service | Git SHA the CD workflow built and pushed |
| `global.imageRegistry` | aura-service | ECR registry of the account |
| `global.auth.issuer`, `global.auth.jwksUrl`, `global.auth.clientIds` | aura-service | Cognito user pool and app clients |
| `web.appUrl`, `web.oidcDomainUrl`, `web.oidcClientId` | aura-service (web) | Public domain, Cognito hosted UI domain, web app client |
| `ingress.host` | aura-service (api-gateway, web) | `origin.<domain>` |
| `ingress.originVerify.value` | aura-service (api-gateway, web) | Secrets Manager, passed with `set_sensitive` |
| `global.datastores.postgres.cidrs`, `global.datastores.redis.cidrs` | aura-service (prod) | Isolated subnet CIDRs of RDS and ElastiCache |
| `environments.<env>.secretsRoleArn`, `environments.<env>.originHost` | aura-platform | IAM role per environment that may read only `auracoach/<env>/*`; origin host |
| `system.secretsRoleArn`, `acme.email`, `acme.hostedZoneId` | aura-platform | Role reading `auracoach/<cluster>/platform`; Let's Encrypt account e-mail; Route 53 zone |

### Sizing (Stage 1)

| | prod (`t4g.xlarge`, 16 GiB) | dev and staging (`t4g.large`, 8 GiB, both on one node) |
|---|---|---|
| NestJS http | 2 replicas, request 100m / 256 Mi, limit 512 Mi | 1 replica, 50m / 160 Mi, limit 384 Mi |
| NestJS worker | 1, request 50m / 192 Mi, limit 384 Mi | 1, 25m / 128 Mi, limit 320 Mi |
| api-gateway | 2, 50m / 32 Mi, limit 128 Mi | 1, same |
| web | 2, 50m / 192 Mi, limit 512 Mi | 1, same |
| Postgres, Redis | RDS, ElastiCache | 50m / 256 Mi and 25m / 64 Mi per environment |
| Total requests | ≈ 5.3 GiB, 1.95 vCPU | ≈ 5.0 GiB, 1.4 vCPU for both environments |

That leaves room in prod for a surge pod per rolling update and the system add-ons. HPA is in the chart but off on k3s; there is nowhere to scale to on one node. Scale up the instance first (ADR-007 triggers).

## 3. Secrets

AWS Secrets Manager, synced by External Secrets into Kubernetes Secrets. Never in Git, values or Terraform state.

| Secrets Manager key | Properties | Read by |
|---|---|---|
| `auracoach/<env>/<service>` | `DATABASE_URL` (app user, DML only), `REDIS_URL` (Redis ACL user), `MIGRATION_DATABASE_URL` (owner user, DDL) | that service; the migration key only by its migration Job |
| `auracoach/<env>/shared` | `INTERNAL_TOKEN_SECRET` | every NestJS service |
| `auracoach/<env>/web` | `SESSION_SECRET`, `OIDC_CLIENT_SECRET` | web |
| `auracoach/<env>/datastores` (non-prod) | `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `<SERVICE>_DB_PASSWORD` | aura-datastores; in non-prod one role per service owns its database, so both URLs use it |
| `auracoach/<cluster>/platform` | `GRAFANA_CLOUD_OTLP_ENDPOINT`, `GRAFANA_CLOUD_INSTANCE_ID`, `GRAFANA_CLOUD_API_TOKEN` | the OpenTelemetry collector |

Each namespace's `SecretStore` assumes the environment's role, which the node role may assume and which can read only that environment's prefix. On the shared non-prod node, dev therefore cannot read staging's secrets.

## 4. Network policy

Every environment namespace starts as deny-all with DNS allowed. Each release then opens exactly:

- **Ingress** to its http pods from the deployables that call it in `global.callGraph`, and for `api-gateway` and `web` from Traefik.
- **Egress** to its callees, to Postgres and Redis (RDS and ElastiCache CIDRs in prod, the `aura-data` pods in non-prod), to the collector on 4318, and where its values say so, to public addresses on 443 (`internetEgress`) and to the instance metadata endpoint (`awsMetadata`, Stage 1 only).

| Deployable | Internet 443 | Metadata (node role) | Why |
|---|---|---|---|
| profile-service | yes | yes | Cognito admin API |
| workout-service | yes | yes | S3 exercise media |
| nutrition-service | yes | no | Open Food Facts |
| coach-service | yes | no | AI provider |
| notification-service | yes | yes | Expo Push, SES |
| web | yes | no | Cognito token endpoint |
| progress-service, audit-service | yes | yes | AWS AppConfig only (feature flags) |
| api-gateway | no | no | internal only |

Every NestJS service reads feature flags from AWS AppConfig (`global.flags.source: appconfig`, application `auracoach`, environment = `dev`/`staging`/`prod`, profile `flags`; platform LLD §11), so each gets 443 egress and, in Stage 1, the metadata endpoint for the node role. A NetworkPolicy cannot narrow 443 to AppConfig's addresses; the Route 53 DNS Firewall allow-list is what limits the domains.

`global.callGraph` is the single source for the allow-lists, `INTERNAL_SERVICE_URLS` and the gateway's upstreams. CI compares it with the service catalog diagram and checks every rendered policy against it, so a new call needs a catalog (ADR) change first.

## 5. How a deploy runs (documented, not executed)

The CD workflow (TAC-37) opens an SSM port forward to the node's k3s API and runs `terraform apply` on the `service` stack, whose `helm_release` for one deployable is equivalent to:

```bash
# Prod example. Non-prod: --namespace dev-aura-services and values/env/dev.yaml.
helm upgrade --install profile-service infra/helm/aura-service \
  --namespace aura-services \
  -f infra/helm/values/common.yaml \
  -f infra/helm/values/env/prod.yaml \
  -f infra/helm/values/profile-service.yaml \
  --set image.tag="$GIT_SHA" \
  --set global.imageRegistry="$ECR_REGISTRY" \
  --set global.auth.issuer="$COGNITO_ISSUER" \
  --set global.auth.jwksUrl="$COGNITO_ISSUER/.well-known/jwks.json" \
  --set "global.auth.clientIds={$WEB_CLIENT_ID,$MOBILE_CLIENT_ID}" \
  --set "global.datastores.postgres.cidrs={$DATA_SUBNET_A,$DATA_SUBNET_B}" \
  --set "global.datastores.redis.cidrs={$DATA_SUBNET_A,$DATA_SUBNET_B}" \
  --atomic --wait --timeout 10m
```

What happens:

1. Hooks: the migration ServiceAccount and NetworkPolicy, then its ExternalSecret, then the Job. External Secrets fills the Secret within seconds; until then the Job's pod waits. A failed migration fails the release and nothing else changes.
2. ConfigMap, ExternalSecret, Service and NetworkPolicies are applied; both Deployments roll one pod at a time and wait for readiness.
3. With `--atomic`, a release that does not become ready in time is rolled back to the previous revision. The database is not rolled back, which is why only expand migrations ship with code ([deployment architecture §4](../architecture/deployment-architecture.md#4-cicd-github-actions)).

Order across deployables: services first (any order; each degrades gracefully when a callee is missing), then `api-gateway` (nginx resolves its upstreams at start), then `web`.

Roll back a bad release: `helm rollback <deployable> <revision> -n <namespace>`, or re-run the deploy with the previous SHA.

Hook objects (the migration ServiceAccount, NetworkPolicy and ExternalSecret) are not part of the release's manifest, so `helm uninstall` leaves them. Delete them with `kubectl delete sa,networkpolicy,externalsecret -l app.kubernetes.io/component=migrate -n <namespace>` after an uninstall.

### Stage 2 (EKS)

Add `-f infra/helm/values/stage/eks.yaml` and the IRSA role as `serviceAccount.annotations."eks\.amazonaws\.com/role-arn"`. The chart then renders an ALB `Ingress` (with a listener condition on `X-Origin-Verify`) instead of a Traefik `IngressRoute`, turns HPA on and spreads replicas over zones. No application change.

## 6. Validation in CI

The `Helm charts` job runs on changes to `infra/helm/`, `infra/k3s/`, the catalog, Dockerfiles or workflows: `tools/ci/helm-validate.sh --addons`.

| Step | What it proves |
|---|---|
| `helm lint --strict` | Charts and values schemas; every deployable × environment |
| `helm template` | 27 Stage 1 releases, 9 Stage 2 releases, both platform variants, both non-prod data stores, and the three add-ons at their pinned versions |
| `kubeconform -strict` (Kubernetes 1.36, k3s `v1.36.5+k3s1`) | Every object against the API schemas, CRDs (ExternalSecret, IngressRoute, Certificate, HelmChartConfig) from the datree CRDs catalog |
| `kube-linter` with `infra/helm/.kube-linter.yaml` | Non-root, read-only root filesystem, resources set, probes, anti-affinity, PDBs, no host access. Exceptions are annotations with a reason |
| `tools/ci/check-network-policies.mjs` | Call graph equals the catalog; rendered policies, `INTERNAL_SERVICE_URLS` and gateway upstreams match it; migration hook and probes everywhere; no secret in any values file |

Run it locally with the same tools on `PATH` (helm 3, kubeconform, kube-linter, yq v4): `tools/ci/helm-validate.sh` (add `--addons` if the chart repositories are reachable).

### k3d smoke (optional)

`tools/smoke/k3d-smoke.sh` builds the profile-service image, creates a throwaway k3d cluster on the pinned k3s version, installs `aura-datastores` and `aura-service` for profile-service with the dev values, and checks that the migration hook, probes, worker, restricted Pod Security and NetworkPolicies work (the gateway label gets through, any other pod does not). It creates Secrets directly instead of installing External Secrets, and deletes the cluster at the end (`KEEP_CLUSTER=1` keeps it). CI runs it as a non-blocking job.

## 7. Known gaps

| Gap | Owner |
|---|---|
| The web app has no Dockerfile or health route yet; its values assume an image `auracoach/web` serving on 3000 and probe `/auth/sign-in` | TAC-37 |
| coach-service will need the AI provider key in `auracoach/<env>/coach-service` and in `secrets.keys` | TAC-25 |
| Terraform must create the Secrets Manager entries, IAM roles, ECR repositories, the AppConfig application `auracoach` with a `flags` profile per environment, and the `helm_release` resources described here | TAC-36 |
| The `X-Origin-Verify` value sits in the IngressRoute object; anyone who can read IngressRoutes in `aura-edge` can read it. Cluster access is limited to the deploy role and operators (SSM) | accepted for beta |
| system-upgrade-controller and OS patching plans | TAC-41 |
