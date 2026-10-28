#!/usr/bin/env bash
# Installs or upgrades everything one cluster needs before any deployable (deployment.md §1):
#   1. the add-ons pinned in infra/k3s/addons.yaml (cert-manager, external-secrets)
#   2. aura-platform (namespaces, default deny, SecretStores, origin certificate, ClusterIssuer)
#   3. add-ons marked afterPlatform (otel-collector, which reads a Secret aura-platform syncs)
#   4. aura-datastores per non-prod environment (Postgres and Redis for dev and staging)
# Usage: install-platform.sh <nonprod|prod> <platform-inputs.json>
#   platform-inputs.json from tools/deploy/deploy-inputs.mjs (no secrets)
# Environment: HELM_TIMEOUT (default 10m); DRY_RUN=1 renders with `helm template` into OUT instead.
# Needs helm and yq (mikefarah, v4).
set -euo pipefail

cd "$(dirname "$0")/../.."
cluster="${1:?nonprod or prod}" inputs="${2:?platform-inputs.json}"
case "$cluster" in nonprod) envs=(dev staging) ;; prod) envs=() ;; *) echo "unknown cluster $cluster" >&2; exit 2 ;; esac
[[ -f "$inputs" ]] || { echo "inputs file $inputs not found" >&2; exit 2; }
timeout="${HELM_TIMEOUT:-10m}"
dry="${DRY_RUN:-}"
if [[ "$dry" == 1 ]]; then OUT="${OUT:-$(mktemp -d)}"; mkdir -p "$OUT"; fi

release() { # name chart namespace [helm args...]
  local name="$1" chart="$2" ns="$3"
  shift 3
  if [[ "$dry" == 1 ]]; then
    helm template "$name" "$chart" --namespace "$ns" ${K8S_VERSION:+--kube-version "$K8S_VERSION"} "$@" >"$OUT/$name.yaml"
    echo "rendered $name -> $OUT/$name.yaml"
  else
    echo "::group::helm upgrade $name ($ns)"
    helm upgrade --install "$name" "$chart" --namespace "$ns" --create-namespace "$@" \
      --atomic --wait --timeout "$timeout" --history-max 10
    echo "::endgroup::"
  fi
}

addons() { # after-platform: true | false
  while read -r name namespace repository chart version values; do
    release "$name" "$chart" "$namespace" --repo "$repository" --version "$version" -f "infra/k3s/$values"
  done < <(yq ".releases[] | select((.afterPlatform // false) == $1) | [.name, .namespace, .repository, .chart, .version, .values] | join(\" \")" infra/k3s/addons.yaml)
}

# 1. Add-ons in file order (cert-manager and external-secrets bring the CRDs aura-platform uses).
addons false
# 2. Platform.
release platform infra/helm/aura-platform aura-system -f "infra/helm/aura-platform/values-$cluster.yaml" -f "$inputs"
# 3. Add-ons that need what the platform created.
addons true
# 4. Non-prod data stores.
for e in "${envs[@]}"; do
  release "datastores-$e" infra/helm/aura-datastores "$e-aura-data" -f "infra/helm/aura-datastores/values-$e.yaml"
done
