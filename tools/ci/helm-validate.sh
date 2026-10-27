#!/usr/bin/env bash
# Lints and renders every chart for every deployable and environment, then validates the manifests
# (kubeconform), checks them against policy (kube-linter) and compares the NetworkPolicies with the
# service catalog. Never talks to a cluster. Usage: tools/ci/helm-validate.sh [--addons]
#   --addons  also render the third-party add-ons in infra/k3s/addons.yaml (needs their chart repos)
# Needs helm, kubeconform, kube-linter and yq (mikefarah, v4) on PATH (CI installs pinned versions).
set -euo pipefail

cd "$(dirname "$0")/../.."
HELM_DIR=infra/helm
K8S_VERSION="${K8S_VERSION:-1.36.0}"
OUT="${OUT:-$(mktemp -d)}"
DEPLOYABLES=(api-gateway web profile-service workout-service nutrition-service progress-service coach-service notification-service audit-service)
ENVS=(dev staging prod)

namespace_of() { # deployable env
  local prefix=""
  [[ "$2" != prod ]] && prefix="$2-"
  case "$1" in api-gateway | web) echo "${prefix}aura-edge" ;; *) echo "${prefix}aura-services" ;; esac
}

service_values() { # deployable env [stage]
  local args=(-f "$HELM_DIR/values/common.yaml" -f "$HELM_DIR/values/env/$2.yaml" -f "$HELM_DIR/values/$1.yaml")
  [[ -n "${3:-}" ]] && args+=(-f "$HELM_DIR/values/stage/$3.yaml")
  args+=(-f "$HELM_DIR/ci/deploy-inputs.yaml")
  [[ "$2" == prod ]] && args+=(-f "$HELM_DIR/ci/deploy-inputs-prod.yaml")
  printf '%s\n' "${args[@]}"
}

echo "== helm lint"
helm lint --strict "$HELM_DIR/aura-platform" -f "$HELM_DIR/aura-platform/values-nonprod.yaml" -f "$HELM_DIR/ci/platform-inputs-nonprod.yaml"
helm lint --strict "$HELM_DIR/aura-datastores" -f "$HELM_DIR/aura-datastores/values-dev.yaml"
for d in "${DEPLOYABLES[@]}"; do
  for e in "${ENVS[@]}"; do
    mapfile -t values < <(service_values "$d" "$e")
    helm lint --strict --quiet "$HELM_DIR/aura-service" --namespace "$(namespace_of "$d" "$e")" "${values[@]}" >/dev/null ||
      { helm lint --strict "$HELM_DIR/aura-service" "${values[@]}"; exit 1; }
  done
done
echo "lint ok"

echo "== helm template -> $OUT"
mkdir -p "$OUT/k3s" "$OUT/eks" "$OUT/platform"
for d in "${DEPLOYABLES[@]}"; do
  for e in "${ENVS[@]}"; do
    mapfile -t values < <(service_values "$d" "$e")
    helm template "$d" "$HELM_DIR/aura-service" --kube-version "$K8S_VERSION" \
      --namespace "$(namespace_of "$d" "$e")" "${values[@]}" >"$OUT/k3s/$e-$d.yaml"
  done
  # Stage 2 (EKS) renders from the same chart and values plus the stage overlay.
  mapfile -t values < <(service_values "$d" prod eks)
  helm template "$d" "$HELM_DIR/aura-service" --kube-version "$K8S_VERSION" \
    --namespace "$(namespace_of "$d" prod)" "${values[@]}" >"$OUT/eks/prod-$d.yaml"
done
for c in nonprod prod; do
  helm template platform "$HELM_DIR/aura-platform" --kube-version "$K8S_VERSION" --namespace aura-system \
    -f "$HELM_DIR/aura-platform/values-$c.yaml" -f "$HELM_DIR/ci/platform-inputs-$c.yaml" >"$OUT/platform/$c.yaml"
done
for e in dev staging; do
  helm template "datastores-$e" "$HELM_DIR/aura-datastores" --kube-version "$K8S_VERSION" --namespace "$e-aura-data" \
    -f "$HELM_DIR/aura-datastores/values-$e.yaml" >"$OUT/platform/datastores-$e.yaml"
done
cp infra/k3s/traefik-config.yaml "$OUT/platform/traefik-config.yaml"

if [[ "${1:-}" == "--addons" ]]; then
  mkdir -p "$OUT/addons"
  yq '.releases[] | [.name, .namespace, .repository, .chart, .version, .values] | join(" ")' infra/k3s/addons.yaml |
    while read -r name namespace repository chart version values; do
    helm template "$name" "$chart" --repo "$repository" --version "$version" --namespace "$namespace" \
      --kube-version "$K8S_VERSION" -f "infra/k3s/$values" >"$OUT/addons/$name.yaml"
    echo "rendered $name $version"
  done
fi
echo "rendered $(find "$OUT" -name '*.yaml' | wc -l) files"

echo "== kubeconform (Kubernetes $K8S_VERSION, strict)"
kubeconform -strict -summary -kubernetes-version "$K8S_VERSION" \
  -schema-location default \
  -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' \
  "$OUT"

echo "== kube-linter"
# Third-party add-ons follow their upstream defaults; policy applies to what we own.
kube-linter lint --config infra/helm/.kube-linter.yaml "$OUT/k3s" "$OUT/eks" "$OUT/platform"

echo "== NetworkPolicies and values vs service catalog"
JSON="$(mktemp -d)"
mkdir -p "$JSON/k3s" "$JSON/eks" "$JSON/values"
for stage in k3s eks; do
  for f in "$OUT/$stage"/*.yaml; do yq -o=json -I=0 '.' "$f" >"$JSON/$stage/$(basename "$f" .yaml).json"; done
done
yq -o=json -I=0 '.' "$HELM_DIR/values/common.yaml" >"$JSON/common.json"
while read -r f; do
  rel="${f#"$HELM_DIR"/}"
  yq -o=json -I=0 '.' "$f" >"$JSON/values/${rel//\//--}.json"
done < <(find "$HELM_DIR" -name '*.yaml' -not -path '*/templates/*')
node tools/ci/check-network-policies.mjs "$JSON"
