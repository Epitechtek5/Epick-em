#!/usr/bin/env bash
# Déploie un SHA déjà testé et publié sur un environnement (demo | production), le vérifie, puis
# — pour la démo seulement — complète les données de démonstration. Utilisé par
# .github/workflows/cd.yml ; lançable à la main avec un KUBECONFIG (docs/exploitation/deploiement.md).
#
#   scripts/deploy/deploy.sh <environnement> <sha> [--rollback]
#
# Variables : NAMESPACE, RELEASE (défaut epickem), PUBLIC_URL (smoke test ; vide = via
# port-forward), HELM_EXTRA_ARGS (valeurs supplémentaires, ex. hôte public), TIMEOUT (10m).
set -Eeuo pipefail

ENVIRONMENT=${1:?environnement requis (demo | production)}
SHA=${2:?SHA du commit requis}
ROLLBACK=${3:-}
RELEASE=${RELEASE:-epickem}
TIMEOUT=${TIMEOUT:-10m}
CHART=$(cd "$(dirname "$0")/../../deploy/helm/epickem" && pwd)
VALUES="$CHART/values-$ENVIRONMENT.yaml"

case "$ENVIRONMENT" in
  demo) NAMESPACE=${NAMESPACE:-epickem-demo} ;;
  production) NAMESPACE=${NAMESPACE:-epickem} ;;
  *) echo "Environnement inconnu : $ENVIRONMENT" >&2; exit 2 ;;
esac
[[ $SHA =~ ^[0-9a-f]{40}$ ]] || { echo "SHA complet attendu, reçu : $SHA" >&2; exit 2; }

log() { echo "::group::$*" 2>/dev/null; }
endlog() { echo "::endgroup::"; }

diagnostics() {
  echo "Échec du déploiement de $SHA sur $ENVIRONMENT — état du namespace :" >&2
  kubectl -n "$NAMESPACE" get pods,jobs >&2 || true
  kubectl -n "$NAMESPACE" get events --sort-by=.lastTimestamp 2>&1 | tail -30 >&2 || true
  for c in api-public api-internal web migrations; do
    echo "--- journaux $c ---" >&2
    kubectl -n "$NAMESPACE" logs -l "app.kubernetes.io/component=$c" --tail=50 --all-containers 2>&1 >&2 || true
  done
  helm -n "$NAMESPACE" history "$RELEASE" --max 5 >&2 || true
}
trap diagnostics ERR

# 1. Ne jamais revenir silencieusement en arrière : un run plus ancien qui arrive après un plus
#    récent (workflow_run sans ordre garanti) est ignoré, sauf retour arrière demandé.
DEPLOYED=$(helm -n "$NAMESPACE" get values "$RELEASE" -o json 2>/dev/null | jq -r '.image.tag // empty' || true)
if [[ -n $DEPLOYED && $DEPLOYED != "$SHA" && $ROLLBACK != --rollback ]]; then
  if git merge-base --is-ancestor "$SHA" "$DEPLOYED" 2>/dev/null; then
    echo "$ENVIRONMENT exécute déjà $DEPLOYED, plus récent que $SHA : rien à faire."
    trap - ERR; exit 0
  fi
fi

# 2. Mise à jour : migrations (hook), puis rolling update. --atomic revient tout seul à la
#    révision précédente si un pod ou le Job de migration échoue.
log "helm upgrade $RELEASE ($ENVIRONMENT, $SHA)"
# shellcheck disable=SC2086
helm upgrade --install "$RELEASE" "$CHART" --namespace "$NAMESPACE" \
  -f "$VALUES" --set image.tag="$SHA" ${HELM_EXTRA_ARGS:-} \
  --atomic --wait --timeout "$TIMEOUT" --history-max 10
endlog

# 3. Smoke test : site, API à travers le web (même chemin que les utilisateurs), version servie.
log "smoke test"
PF_PID=
stop_pf() { if [[ -n $PF_PID ]]; then kill "$PF_PID" 2>/dev/null || true; fi; }
# Sans URL publique (essai local, cluster kind) : port-forward vers le web, relancé s'il tombe.
start_pf() {
  if [[ -n ${LOCAL_SMOKE:-} ]] && { [[ -z $PF_PID ]] || ! kill -0 "$PF_PID" 2>/dev/null; }; then
    kubectl -n "$NAMESPACE" port-forward "svc/$RELEASE-web" 18080:80 >/dev/null 2>&1 &
    PF_PID=$!
    sleep 2
  fi
}
if [[ -z ${PUBLIC_URL:-} ]]; then
  LOCAL_SMOKE=1
  PUBLIC_URL=http://127.0.0.1:18080
fi
for i in $(seq 1 30); do
  start_pf
  if curl -fsS "$PUBLIC_URL/healthz" >/dev/null && curl -fsS "$PUBLIC_URL/api/health" >/dev/null; then
    break
  fi
  if [[ $i == 30 ]]; then stop_pf; echo "Smoke test en échec sur $PUBLIC_URL" >&2; false; fi
  sleep 5
done
curl -fsS "$PUBLIC_URL/" | grep -qi '<html' || { stop_pf; echo "La page d'accueil ne répond pas" >&2; false; }
echo "OK : $PUBLIC_URL sert $SHA"
endlog

# 4. Données de démonstration : démo uniquement (idempotent). Jamais en production.
if [[ $ENVIRONMENT == demo ]]; then
  log "données de démonstration"
  python3 "$(dirname "$0")/../../seed_demo.py" --bootstrap-admin --demo-environment \
    --url "$PUBLIC_URL/api" \
    --exec "kubectl exec -i -n $NAMESPACE statefulset/$RELEASE-postgres --" \
    --output "$(mktemp -d)/seed-manifest.json"
  endlog
fi
stop_pf
trap - ERR
