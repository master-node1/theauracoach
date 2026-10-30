#!/usr/bin/env bash
# Post-deploy smoke for one environment (TAC-37), run by .github/workflows/deploy.yml after Helm.
#   1. every given release is `deployed` and its Deployments are fully available;
#   2. when SMOKE_API_URL / SMOKE_APP_URL are set (public CloudFront hosts), the whole edge path works:
#      the web app's /api/health answers 200, and an unauthenticated GET /v1/me reaches the gateway and
#      profile-service and is refused with 401 (only /v1 is routed publicly, not the gateway's /health).
# Usage: deploy-smoke.sh <env> <deployable>...   (needs kubectl and helm with a working KUBECONFIG)
set -euo pipefail

env="${1:?env}"
shift
prefix=""
[[ "$env" != prod ]] && prefix="$env-"
fail=0

for d in "$@"; do
  case "$d" in api-gateway | web) ns="${prefix}aura-edge" ;; *) ns="${prefix}aura-services" ;; esac
  status="$(helm status "$d" --namespace "$ns" -o json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).info.status))')"
  if [[ "$status" != deployed ]]; then
    echo "::error::$d in $ns is $status"
    fail=1
    continue
  fi
  if ! kubectl wait deployment --namespace "$ns" -l "app.kubernetes.io/instance=$d-$env" --for=condition=Available --timeout=120s >/dev/null; then
    echo "::error::$d in $ns has Deployments that are not available"
    kubectl get pods --namespace "$ns" -l "app.kubernetes.io/instance=$d-$env" -o wide || true
    fail=1
    continue
  fi
  echo "ok $d ($ns)"
done

check_url() { # name url expected-status
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 --retry 5 --retry-delay 5 "$2" || true)"
  if [[ "$code" == "$3" ]]; then echo "ok $1 $2 ($code)"; else echo "::error::$1 $2 answered $code, expected $3"; fail=1; fi
}
if [[ -n "${SMOKE_API_URL:-}" ]]; then check_url api-gateway "${SMOKE_API_URL%/}/v1/me" 401; fi
if [[ -n "${SMOKE_APP_URL:-}" ]]; then check_url web "${SMOKE_APP_URL%/}/api/health" 200; fi

exit "$fail"
