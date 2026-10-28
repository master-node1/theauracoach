{{- define "aura-datastores.instance" -}}
datastores-{{ .Values.environment }}
{{- end -}}

{{/* Call with (dict "ctx" $ "name" "postgres"). */}}
{{- define "aura-datastores.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ include "aura-datastores.instance" .ctx }}
{{- end -}}

{{- define "aura-datastores.labels" -}}
{{ include "aura-datastores.selectorLabels" . }}
app.kubernetes.io/part-of: auracoach
app.kubernetes.io/managed-by: {{ .ctx.Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .ctx.Chart.Name .ctx.Chart.Version }}
environment: {{ .ctx.Values.environment }}
{{- end -}}

{{- define "aura-datastores.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
fsGroup: {{ .uid }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "aura-datastores.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
runAsNonRoot: true
capabilities:
  drop: ['ALL']
{{- end -}}

{{/* Only the services namespace may reach the data stores. */}}
{{- define "aura-datastores.networkPolicy" -}}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ .name }}
  namespace: {{ .ctx.Release.Namespace }}
  labels:
    {{- include "aura-datastores.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "aura-datastores.selectorLabels" . | nindent 6 }}
  policyTypes: [Ingress]
  ingress:
    - ports:
        - protocol: TCP
          port: {{ .port }}
      from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ printf "%s%s" .ctx.Values.namespacePrefix .ctx.Values.namespaces.services }}
{{- end -}}
