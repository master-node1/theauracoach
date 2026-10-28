#!/usr/bin/env bash
# Local k3d smoke test for the Helm chart (TAC-35): installs profile-service with the real chart and
# dev values into a throwaway k3d cluster, with Postgres and Redis from the aura-datastores chart.
# Proves the migration hook, probes, read-only root filesystem, restricted Pod Security and the
# NetworkPolicies work against the real image. Nothing leaves this machine; the cluster is deleted at
# the end. External Secrets is not installed here: the Secrets are created directly with throwaway
# values (secrets.source=existing). Usage: tools/smoke/k3d-smoke.sh   (needs docker, k3d, helm, kubectl)
set -euo pipefail

cd "$(dirname "$0")/../.."
CLUSTER="${CLUSTER:-aura-smoke}"
K3S_IMAGE="${K3S_IMAGE:-rancher/k3s:v1.36.5-k3s1}"
SERVICE=profile-service
TAG=smoke
SVC_NS=dev-aura-services
DATA_NS=dev-aura-data
EDGE_NS=dev-aura-edge
# Throwaway credentials for a cluster that lives for a few minutes on this machine.
PG_PASSWORD="smoke-$(openssl rand -hex 12)"
DB_PASSWORD="smoke-$(openssl rand -hex 12)"
REDIS_PASSWORD="smoke-$(openssl rand -hex 12)"

cleanup() {
  if [[ "${KEEP_CLUSTER:-}" != 1 ]]; then k3d cluster delete "$CLUSTER" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

step() { echo "== $*"; }

step "build $SERVICE image"
docker build -q -f "services/$SERVICE/Dockerfile" -t "auracoach/$SERVICE:$TAG" .

step "create k3d cluster ($K3S_IMAGE)"
k3d cluster create "$CLUSTER" --image "$K3S_IMAGE" --agents 0 --wait --timeout 180s \
  --k3s-arg '--disable=traefik@server:0'
k3d image import -c "$CLUSTER" "auracoach/$SERVICE:$TAG"

step "namespaces: restricted Pod Security, default deny plus DNS (what aura-platform renders)"
for ns in "$SVC_NS" "$DATA_NS" "$EDGE_NS"; do
  kubectl create namespace "$ns"
done
for ns in "$SVC_NS" "$DATA_NS"; do
  kubectl label namespace "$ns" pod-security.kubernetes.io/enforce=restricted
  kubectl apply -n "$ns" -f - <<'YAML'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny }
spec: { podSelector: {}, policyTypes: [Ingress, Egress] }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-dns }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
      to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
YAML
done

step "Postgres and Redis (aura-datastores chart)"
db_args=()
for svc in profile workout nutrition progress coach notification audit; do
  db_args+=(--from-literal="$(echo "$svc" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD=$DB_PASSWORD")
done
kubectl -n "$DATA_NS" create secret generic datastores \
  --from-literal=POSTGRES_PASSWORD="$PG_PASSWORD" --from-literal=REDIS_PASSWORD="$REDIS_PASSWORD" "${db_args[@]}"
helm install datastores-dev infra/helm/aura-datastores -n "$DATA_NS" \
  -f infra/helm/aura-datastores/values-dev.yaml --set externalSecret=false \
  --set postgres.storage=1Gi --set redis.storage=256Mi --wait --timeout 5m

step "$SERVICE secrets (stand-ins for External Secrets)"
db_url="postgresql://profile_svc:$DB_PASSWORD@postgres.$DATA_NS.svc.cluster.local:5432/profile_db"
kubectl -n "$SVC_NS" create secret generic "$SERVICE-env" \
  --from-literal=DATABASE_URL="$db_url" \
  --from-literal=REDIS_URL="redis://:$REDIS_PASSWORD@redis.$DATA_NS.svc.cluster.local:6379" \
  --from-literal=INTERNAL_TOKEN_SECRET="$(openssl rand -hex 32)"
kubectl -n "$SVC_NS" create secret generic "$SERVICE-migrate" --from-literal=DATABASE_URL="$db_url"

step "helm install $SERVICE (migration hook, http and worker)"
helm install "$SERVICE" infra/helm/aura-service -n "$SVC_NS" \
  -f infra/helm/values/common.yaml -f infra/helm/values/env/dev.yaml -f "infra/helm/values/$SERVICE.yaml" \
  --set image.tag="$TAG" --set image.pullPolicy=Never \
  --set global.otel.endpoint= --set global.flags.source=env \
  --set global.auth.issuer=http://dev-auth.invalid \
  --set global.auth.jwksUrl=http://dev-auth.invalid/.well-known/jwks.json \
  --set 'global.auth.clientIds={aura-dev-client}' \
  --set secrets.source=existing \
  --set "secrets.existing.app=$SERVICE-env" --set "secrets.existing.migration=$SERVICE-migrate" \
  --wait --timeout 8m || {
  kubectl -n "$SVC_NS" get pods,jobs
  kubectl -n "$SVC_NS" logs "job/$SERVICE-migrate" --tail 50 || true
  kubectl -n "$SVC_NS" describe pods | tail -60
  exit 1
}
kubectl -n "$SVC_NS" get pods

step "worker is running"
kubectl -n "$SVC_NS" rollout status "deployment/$SERVICE-worker" --timeout 120s

probe() { # label expected
  local name="probe-$1"
  kubectl -n "$EDGE_NS" run "$name" --image=curlimages/curl:8.11.1 --restart=Never \
    --labels="app.kubernetes.io/name=$1" --command -- \
    curl -sS -m 5 --retry 6 --retry-delay 3 --retry-all-errors -o /dev/null -w '%{http_code}' \
    "http://$SERVICE.$SVC_NS.svc.cluster.local:3000/health/ready" >/dev/null
  # Retries: the network policy controller adds a new pod's IP to its allow sets a moment after the
  # pod starts, so the first attempt can be refused even when the policy allows it.
  kubectl -n "$EDGE_NS" wait --for=jsonpath='{.status.phase}'=Succeeded "pod/$name" --timeout 90s >/dev/null 2>&1 ||
    kubectl -n "$EDGE_NS" wait --for=jsonpath='{.status.phase}'=Failed "pod/$name" --timeout 30s >/dev/null 2>&1 || true
  local phase code
  phase=$(kubectl -n "$EDGE_NS" get "pod/$name" -o jsonpath='{.status.phase}')
  # Last line: curl prints the status code after any retry messages.
  code=$(kubectl -n "$EDGE_NS" logs "pod/$name" 2>/dev/null | tail -n 1 || true)
  echo "$1 -> phase=$phase http=$code"
  if [[ "$2" == allow && ( "$phase" != Succeeded || "$code" != 200 ) ]]; then
    echo "expected $1 to reach $SERVICE"
    kubectl -n "$SVC_NS" get endpoints,networkpolicy -o wide
    kubectl -n "$SVC_NS" get networkpolicy "$SERVICE-ingress" -o yaml
    exit 1
  fi
  if [[ "$2" == deny && "$phase" == Succeeded ]]; then echo "expected $1 to be blocked by NetworkPolicy"; exit 1; fi
}

step "NetworkPolicy: api-gateway may call $SERVICE, anything else may not"
probe api-gateway allow
probe intruder deny

echo "k3d smoke passed"
