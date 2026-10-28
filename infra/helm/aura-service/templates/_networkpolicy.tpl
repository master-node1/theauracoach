{{/* NetworkPolicy peer for a deployable. Call with (dict "ctx" $ "name" "workout-service"). */}}
{{- define "aura.peer" -}}
- namespaceSelector:
    matchLabels:
      kubernetes.io/metadata.name: {{ include "aura.namespaceOf" . }}
  podSelector:
    matchLabels:
      app.kubernetes.io/name: {{ .name }}
{{- end -}}

{{/* Egress rules to data stores. Call with (dict "ctx" $ "stores" (list "postgres" "redis")). */}}
{{- define "aura.datastoreEgress" -}}
{{- $ctx := .ctx -}}
{{- range .stores }}
{{- $store := index $ctx.Values.global.datastores . }}
- ports:
    - protocol: TCP
      port: {{ $store.port }}
  to:
    {{- if $store.cidrs }}
    {{- range $store.cidrs }}
    - ipBlock:
        cidr: {{ . }}
    {{- end }}
    {{- else if $store.podLabels }}
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: {{ printf "%s%s" $ctx.Values.global.namespacePrefix $ctx.Values.global.namespaces.data }}
      podSelector:
        matchLabels:
          {{- toYaml $store.podLabels | nindent 10 }}
    {{- else }}
    {{- fail (printf "global.datastores.%s needs cidrs (RDS/ElastiCache) or podLabels (in-cluster)" .) }}
    {{- end }}
{{- end }}
{{- end -}}
