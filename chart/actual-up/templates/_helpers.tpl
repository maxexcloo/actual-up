{{- define "actual-up.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "actual-up.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "actual-up.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "actual-up.labels" -}}
app.kubernetes.io/name: {{ include "actual-up.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end }}

{{- define "actual-up.selectorLabels" -}}
app.kubernetes.io/name: {{ include "actual-up.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "actual-up.configMapName" -}}
{{- default (include "actual-up.fullname" .) .Values.existingConfigMap }}
{{- end }}
