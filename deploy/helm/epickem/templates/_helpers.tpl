{{- define "epickem.name" -}}{{ .Release.Name }}{{- end -}}

{{- define "epickem.labels" -}}
app.kubernetes.io/part-of: epickem
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | trunc 12 | quote }}
epickem.app/environment: {{ .Values.environment | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "epickem.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Image immuable d'un composant : le tag (SHA du commit) est obligatoire. */}}
{{- define "epickem.image" -}}
{{- $tag := required "image.tag (SHA du commit testé) est obligatoire" .root.Values.image.tag -}}
{{ printf "%s/%s/%s:%s" .root.Values.image.registry .root.Values.image.repository .component $tag }}
{{- end -}}

{{- define "epickem.host" -}}{{ printf "%s-%s" .root.Release.Name .component }}{{- end -}}

{{/* Variables communes aux binaires du backend. */}}
{{- define "epickem.backendEnv" -}}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef: { name: {{ .Values.secrets.existingSecret }}, key: POSTGRES_PASSWORD }
- name: DATABASE_URL
  value: {{ printf "postgres://%s:$(POSTGRES_PASSWORD)@%s-postgres:5432/%s" .Values.postgres.user .Release.Name .Values.postgres.database | quote }}
- name: REDIS_URL
  value: {{ printf "redis://%s-redis:6379" .Release.Name | quote }}
- name: JWT_SECRET
  valueFrom:
    secretKeyRef: { name: {{ .Values.secrets.existingSecret }}, key: JWT_SECRET }
- name: PUBLIC_URL
  value: {{ .Values.publicUrl | quote }}
{{- range $key := list "RESEND_API_KEY" "STARTGG_TOKEN" "GOOGLE_CLIENT_SECRET" "TOTP_ENCRYPTION_KEY" }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef: { name: {{ $.Values.secrets.existingSecret }}, key: {{ $key }}, optional: true }
{{- end }}
{{- end -}}

{{- define "epickem.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  seccompProfile: { type: RuntimeDefault }
{{- end -}}

{{- define "epickem.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: [ALL] }
{{- end -}}
