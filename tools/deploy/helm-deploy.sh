#!/usr/bin/env bash
# Deploys deployables to one environment with the Helm CLI (ADR-010, deployment.md §5): services
# first, then api-gateway, then web, each `helm upgrade --install --atomic` so a release that does not
# become ready is rolled back. The values chain is the one tools/ci/helm-validate.sh renders in CI.
#
# Usage: helm-deploy.sh <env> <image-tag> <inputs.json> <deployable>...
#   env          dev | staging | prod
#   image-tag    Git SHA the images were built from (release-images.yml)
#   inputs.json  deploy inputs from tools/deploy/deploy-inputs.mjs (no secrets)
# Environment:
#   ORIGIN_VERIFY  X-Origin-Verify value for api-gateway and web (Secrets Manager); never logged
#   STAGE          k3s (default) or eks
#   HELM_TIMEOUT   per release, default 10m
#   DRY_RUN=1      render with `helm template` instead of installing (CI; needs no cluster)
#   OUT            where DRY_RUN writes manifests (default: a temp directory)
set -euo pipefail

cd "$(dirname "$0")/../.."
HELM_DIR=infra/helm
env="${1:?env}" tag="${2:?image tag}" inputs="${3:?inputs.json}"
shift 3
[[ $# -gt 0 ]] || { echo "no deployables given" >&2; exit 2; }
case "$env" in dev | staging | prod) ;; *) echo "unknown environment $env" >&2; exit 2 ;; esac
[[ "$tag" =~ ^[0-9a-f]{40}$ ]] || { echo "image tag must be a full Git SHA, got $tag" >&2; exit 2; }
[[ -f "$inputs" ]] || { echo "inputs file $inputs not found" >&2; exit 2; }
stage="${STAGE:-k3s}"
timeout="${HELM_TIMEOUT:-10m}"

namespace_of() { # deployable
  local prefix=""
  [[ "$env" != prod ]] && prefix="$env-"
  case "$1" in api-gateway | web) echo "${prefix}aura-edge" ;; *) echo "${prefix}aura-services" ;; esac
}

# Order: services (any order), then the gateway (nginx resolves upstreams at start), then web.
ordered=()
for d in "$@"; do
  [[ -f "$HELM_DIR/values/$d.yaml" ]] || { echo "unknown deployable $d (no $HELM_DIR/values/$d.yaml)" >&2; exit 2; }
  [[ "$d" != api-gateway && "$d" != web ]] && ordered+=("$d")
done
for d in api-gateway web; do
  for x in "$@"; do [[ "$x" == "$d" ]] && ordered+=("$d") && break; done
done

secret_dir="$(mktemp -d)"
chmod 700 "$secret_dir"
trap 'rm -rf "$secret_dir"' EXIT
origin_values="$secret_dir/origin-verify.json"
needs_origin=false
for d in "${ordered[@]}"; do [[ "$d" == api-gateway || "$d" == web ]] && needs_origin=true; done
if $needs_origin; then
  [[ -n "${ORIGIN_VERIFY:-}" ]] || { echo "ORIGIN_VERIFY must be set to deploy api-gateway or web" >&2; exit 2; }
  # A values file, not --set, so the value never appears in the process list or the log.
  (umask 077 && node -e 'process.stdout.write(JSON.stringify({ingress:{originVerify:{value:process.env.ORIGIN_VERIFY}}}))' >"$origin_values")
fi

if [[ "${DRY_RUN:-}" == 1 ]]; then
  OUT="${OUT:-$(mktemp -d)}"
  mkdir -p "$OUT"
fi

for d in "${ordered[@]}"; do
  ns="$(namespace_of "$d")"
  args=(-f "$HELM_DIR/values/common.yaml" -f "$HELM_DIR/values/env/$env.yaml" -f "$HELM_DIR/values/$d.yaml")
  [[ "$stage" == eks ]] && args+=(-f "$HELM_DIR/values/stage/eks.yaml")
  args+=(-f "$inputs" --set-string "image.tag=$tag")
  [[ "$d" == api-gateway || "$d" == web ]] && args+=(-f "$origin_values")
  if [[ "${DRY_RUN:-}" == 1 ]]; then
    helm template "$d" "$HELM_DIR/aura-service" --namespace "$ns" ${K8S_VERSION:+--kube-version "$K8S_VERSION"} \
      "${args[@]}" >"$OUT/$env-$d.yaml"
    echo "rendered $d -> $OUT/$env-$d.yaml (namespace $ns, image tag $tag)"
  else
    echo "::group::helm upgrade $d ($ns)"
    helm upgrade --install "$d" "$HELM_DIR/aura-service" --namespace "$ns" "${args[@]}" \
      --atomic --wait --timeout "$timeout" --history-max 10
    echo "::endgroup::"
  fi
done
