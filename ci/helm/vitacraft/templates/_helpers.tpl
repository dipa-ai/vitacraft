{{/*
Expand the chart name.
*/}}
{{- define "vitacraft.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a release-qualified resource name.
*/}}
{{- define "vitacraft.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label with a DNS-safe version.
*/}}
{{- define "vitacraft.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Labels shared by all resources.
*/}}
{{- define "vitacraft.labels" -}}
helm.sh/chart: {{ include "vitacraft.chart" . }}
{{ include "vitacraft.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end }}

{{/*
Stable labels used by Deployment selectors and the Service.
*/}}
{{- define "vitacraft.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vitacraft.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
