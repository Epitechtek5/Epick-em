# ADR-007 — Gestion des secrets

- **Statut :** Accepté
- **Date :** 2026-10-19
- **Décideurs :** équipe backend/devops
- **Issue liée :** #…

## Contexte

Le sujet exige :

- un `.env.example` documenté et **aucun secret dans le dépôt ni dans l'historique**, jeton start.gg compris ;
- les secrets du pipeline stockés dans les **secrets GitHub**, jamais dans le code ;
- une branche principale protégée, où une PR dont le pipeline échoue ne peut pas être mergée.

Secrets identifiés : jeton API start.gg, identifiants PostgreSQL et Redis, clé de signature des sessions/JWT, kubeconfig ou accès SSH au serveur, jeton de publication des images.

## Décision

| Contexte | Mécanisme |
|---|---|
| **Développement local** | Fichier `.env` (ignoré par git) créé à partir de `.env.example`. Valeurs par défaut sans risque pour tout ce qui est local ; le jeton start.gg est optionnel (les tests utilisent des mocks). |
| **CI/CD** | Secrets GitHub (`STARTGG_TOKEN`, `KUBECONFIG_B64`, `SSH_PRIVATE_KEY`…), injectés uniquement dans les jobs qui en ont besoin. Publication des images via `GITHUB_TOKEN`. |
| **Infrastructure (Ansible)** | Variables sensibles chiffrées avec **Ansible Vault** ; mot de passe du vault dans les secrets GitHub. |
| **Kubernetes** | `Secret` Kubernetes créés par le déploiement à partir des valeurs du vault, jamais écrits en clair dans `values.yaml`. |

### Garde-fous

- **gitleaks** en hook pre-commit **et** en job CI requis : une PR contenant un secret ne peut pas être mergée.
- `.gitignore` couvrant `.env`, kubeconfigs et fichiers de vault déchiffrés.
- Protection de `main` : PR obligatoire, au moins une relecture, checks CI requis, pas de push direct ni de force-push.
- En cas de fuite : révocation immédiate du secret, rotation, et réécriture de l'historique si nécessaire. Procédure décrite dans `docs/exploitation/securite.md`.

## Conséquences

- **Positives :** conformité directe au sujet ; détection automatique des fuites ; onboarding local sans aucun secret.
- **Négatives / coûts acceptés :** gestion d'un mot de passe Ansible Vault partagé dans l'équipe ; rotation manuelle des secrets.
- **Actions à mener :**
  - Rédiger `.env.example` avec une ligne de commentaire par variable.
  - Ajouter gitleaks au pre-commit et à la CI.
  - Configurer la protection de branche dès la création du dépôt.
