# ADR-005 — Docker Compose en local, Kubernetes (k3s) + Helm + Ansible en ligne

- **Statut :** Accepté
- **Date :** 2026-10-19
- **Décideurs :** équipe backend/devops
- **Issue liée :** #…

## Contexte

Exigences du sujet :

- **Installation en une commande** pour un nouveau contributeur, avec données de démonstration et simulateur.
- **Déploiement continu :** chaque merge sur la branche principale met à jour automatiquement la plateforme en ligne, avec ses données de démonstration, sur une **offre d'hébergement gratuite** au choix.
- Build mobile installable produit à chaque merge (artefact du pipeline).
- Secrets du pipeline dans les secrets GitHub.

Composants à déployer : api-public, api-internal, front web, PostgreSQL, Redis, migrations, simulateur (démo), ingress HTTPS.

## Options étudiées

### Option A — PaaS gratuit (Render, Fly.io, Railway…)
- ✅ Peu de travail d'infrastructure.
- ❌ Offres gratuites limitées et changeantes (mise en veille, quotas, bases éphémères), WebSocket et Redis parfois payants.
- ❌ Peu de valeur démontrable sur la partie devops.

### Option B — Docker Compose partout (local et serveur)
- ✅ Un seul outil.
- ❌ Pas de rolling update, de healthchecks orchestrés ni de scaling d'api-public.

### Option C — Docker Compose en local, Kubernetes (k3s) en ligne
- ✅ Compose : idéal pour le nouvel arrivant.
- ✅ k3s : léger, tient sur une VM gratuite, rolling updates, probes, scaling horizontal d'api-public (utile pour les tests de charge).
- ✅ Compétence déjà maîtrisée dans l'équipe.
- ❌ Deux descriptions de l'environnement à garder cohérentes.

## Décision

**Nous retenons l'option C.**

### Local : Docker Compose

- `docker compose up` lance PostgreSQL, Redis, les migrations (service one-shot, voir ADR-006), api-public, api-internal et le web.
- `docker compose --profile demo up` ajoute le simulateur, qui joue un tournoi `quick`.
- Les images sont buildées localement depuis le monorepo ; aucune image privée ni secret requis.

### En ligne : k3s + Helm + Ansible

- **Hébergement :** une VM de l'offre gratuite d'un fournisseur cloud (cible : Oracle Cloud Always Free, instance ARM), avec k3s en nœud unique.
- **Helm :** un chart `deploy/helm/epickem` contenant api-public (Deployment + HPA possible), api-internal, web, PostgreSQL, Redis, Job de migration (hook `pre-install` / `pre-upgrade`), Ingress avec TLS (cert-manager + Let's Encrypt).
- **Ansible :** provisioning reproductible de la VM (durcissement, pare-feu, k3s, cert-manager) et rôle de déploiement qui exécute `helm upgrade --install` avec les valeurs de l'environnement.
- **Images :** publiées sur GitHub Container Registry, taggées par SHA de commit et par version semver.

### Pipeline CD

À chaque merge sur `main` :

1. Build et push des images modifiées (multi-arch amd64/arm64 pour la VM ARM).
2. Build mobile → artefact du pipeline (APK ou build simulateur).
3. Déploiement : `helm upgrade` avec le SHA du commit (via le playbook Ansible ou directement depuis la CI avec un kubeconfig stocké en secret GitHub).
4. Réinitialisation ou complétion des données de démonstration par le simulateur.
5. Smoke test sur l'URL publique.

### Garde-fous

- Pas de cluster multi-nœuds, pas de GitOps (Argo CD, Flux) : hors périmètre au regard du temps disponible.
- L'infrastructure est posée **pendant les deux premières semaines**, puis n'évolue qu'à la marge.

## Conséquences

- **Positives :** onboarding simple ; déploiement reproductible et automatisé ; partie devops démontrable en soutenance.
- **Négatives / coûts acceptés :** cohérence Compose / Helm à surveiller (mêmes variables d'environnement, documentées dans `.env.example`) ; dépendance à une offre gratuite (plan B : autre fournisseur avec les mêmes playbooks).
- **Actions à mener :**
  - Créer la VM, écrire le playbook de provisioning.
  - Écrire le chart et le valider avec `helm lint` et `helm template` en CI.
  - Documenter la procédure dans `docs/exploitation/deploiement.md` et ajouter le badge du pipeline dans le README.
