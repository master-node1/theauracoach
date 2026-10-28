{{- define "aura-platform.labels" -}}
app.kubernetes.io/part-of: auracoach
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* Namespaces of one environment. Call with (dict "ctx" $ "env" $env). Rendered as a YAML list. */}}
{{- define "aura-platform.namespacesOf" -}}
{{- $ns := list (printf "%s%s" .env.namespacePrefix .ctx.Values.namespaces.edge) (printf "%s%s" .env.namespacePrefix .ctx.Values.namespaces.services) -}}
{{- if .env.inClusterData -}}
{{- $ns = append $ns (printf "%s%s" .env.namespacePrefix .ctx.Values.namespaces.data) -}}
{{- end -}}
{{- toYaml $ns -}}
{{- end -}}
