{{/* Resource name: the deployable name, so in-cluster DNS matches the service catalog. */}}
{{- define "aura.name" -}}
{{- default .Release.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "aura.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aura.name" . }}
app.kubernetes.io/instance: {{ include "aura.name" . }}-{{ .Values.environment }}
{{- end -}}

{{- define "aura.labels" -}}
{{ include "aura.selectorLabels" . }}
app.kubernetes.io/part-of: auracoach
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
environment: {{ .Values.environment }}
{{- end -}}

{{/* Labels of one component (http, worker, migrate). Call with (dict "ctx" $ "component" "http"). */}}
{{- define "aura.componentSelectorLabels" -}}
{{ include "aura.selectorLabels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "aura.componentLabels" -}}
{{ include "aura.labels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* This deployable's catalog entry from global.deployables. */}}
{{- define "aura.self" -}}
{{- $name := include "aura.name" . -}}
{{- $self := index .Values.global.deployables $name -}}
{{- if not $self -}}
{{- fail (printf "%s is not listed in global.deployables (values/common.yaml)" $name) -}}
{{- end -}}
{{- toYaml $self -}}
{{- end -}}

{{/* Namespace of a deployable (by name), with the environment prefix. Call with (dict "ctx" $ "name" "workout-service"). */}}
{{- define "aura.namespaceOf" -}}
{{- $d := index .ctx.Values.global.deployables .name -}}
{{- if not $d -}}
{{- fail (printf "%s is not listed in global.deployables (values/common.yaml)" .name) -}}
{{- end -}}
{{- printf "%s%s" .ctx.Values.global.namespacePrefix (index .ctx.Values.global.namespaces $d.tier) -}}
{{- end -}}

{{/* host:port of a deployable's Service. */}}
{{- define "aura.hostPortOf" -}}
{{- $d := index .ctx.Values.global.deployables .name -}}
{{- printf "%s.%s.svc.cluster.local:%v" .name (include "aura.namespaceOf" .) $d.port -}}
{{- end -}}

{{/* Deployables this one may call (callGraph[self]). Rendered as a YAML list. */}}
{{- define "aura.callees" -}}
{{- $calls := index .Values.global.callGraph (include "aura.name" .) | default list -}}
{{- toYaml $calls -}}
{{- end -}}

{{/* Deployables that may call this one (every key whose list contains self). */}}
{{- define "aura.callers" -}}
{{- $name := include "aura.name" . -}}
{{- $callers := list -}}
{{- range $caller, $calls := .Values.global.callGraph -}}
{{- if has $name $calls -}}
{{- $callers = append $callers $caller -}}
{{- end -}}
{{- end -}}
{{- toYaml (sortAlpha $callers) -}}
{{- end -}}

{{- define "aura.image" -}}
{{- $repo := default (printf "auracoach/%s" (include "aura.name" .)) .Values.image.repository -}}
{{- $tag := required "image.tag is required (deploy input: the git SHA CI built)" .Values.image.tag -}}
{{- if .Values.global.imageRegistry -}}
{{- printf "%s/%s:%s" .Values.global.imageRegistry $repo $tag -}}
{{- else -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end -}}

{{- define "aura.servicePort" -}}
{{- default .Values.containerPort .Values.service.port -}}
{{- end -}}

{{- define "aura.appSecretName" -}}
{{- if eq .Values.secrets.source "existing" -}}
{{- required "secrets.existing.app is required when secrets.source=existing" .Values.secrets.existing.app -}}
{{- else -}}
{{- printf "%s-env" (include "aura.name" .) -}}
{{- end -}}
{{- end -}}

{{- define "aura.migrationSecretName" -}}
{{- if eq .Values.secrets.source "existing" -}}
{{- required "secrets.existing.migration is required when secrets.source=existing" .Values.secrets.existing.migration -}}
{{- else -}}
{{- printf "%s-migrate" (include "aura.name" .) -}}
{{- end -}}
{{- end -}}

{{- define "aura.hasAppSecret" -}}
{{- if or .Values.secrets.keys .Values.secrets.sharedKeys -}}true{{- end -}}
{{- end -}}

{{- define "aura.probe" -}}
httpGet:
  path: {{ .path }}
  port: http
periodSeconds: {{ .cfg.periodSeconds }}
timeoutSeconds: {{ .cfg.timeoutSeconds }}
failureThreshold: {{ .cfg.failureThreshold }}
{{- end -}}

{{- define "aura.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: {{ .Values.podSecurity.runAsUser }}
runAsGroup: {{ .Values.podSecurity.runAsGroup }}
fsGroup: {{ .Values.podSecurity.fsGroup }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "aura.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
runAsNonRoot: true
capabilities:
  drop: ['ALL']
{{- end -}}

{{- define "aura.volumeMounts" -}}
- name: tmp
  mountPath: /tmp
{{- range $i, $p := .Values.writablePaths }}
- name: writable-{{ $i }}
  mountPath: {{ $p }}
{{- end }}
{{- end -}}

{{- define "aura.volumes" -}}
- name: tmp
  emptyDir: { sizeLimit: 64Mi }
{{- range $i, $p := .Values.writablePaths }}
- name: writable-{{ $i }}
  emptyDir: { sizeLimit: 64Mi }
{{- end }}
{{- end -}}

{{/* Soft anti-affinity: spread replicas over nodes when there is more than one (Stage 2). */}}
{{- define "aura.affinity" -}}
podAntiAffinity:
  preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        topologyKey: kubernetes.io/hostname
        labelSelector:
          matchLabels:
            {{- include "aura.componentSelectorLabels" . | nindent 12 }}
{{- end -}}

{{/* Scheduling block shared by Deployments. Call with (dict "ctx" $ "component" "http"). */}}
{{- define "aura.scheduling" -}}
affinity:
  {{- include "aura.affinity" . | nindent 2 }}
{{- with .ctx.Values.topologySpreadConstraints }}
topologySpreadConstraints:
  {{- range . }}
  - {{ toYaml . | nindent 4 | trim }}
    labelSelector:
      matchLabels:
        {{- include "aura.componentSelectorLabels" $ | nindent 8 }}
  {{- end }}
{{- end }}
{{- with .ctx.Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .ctx.Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
