# ADR-001 — Monorepo unique pour tout le projet

- **Statut :** Proposé
- **Date :** 2026-10-19
- **Décideurs :** équipe backend/devops (à valider par l'équipe)
- **Issue liée :** #…

## Contexte

Le projet comporte plusieurs composants : deux API Rust (publique et interne), un front web, une application mobile, des migrations de base de données, un chart Helm, des playbooks Ansible, un simulateur et la documentation.

Le sujet impose plusieurs exigences qui portent sur **le dépôt** au singulier :

- **Test du nouvel arrivant :** un développeur extérieur clone le dépôt et, avec le seul README, lance la plateforme avec un tournoi simulé ainsi que les tests en moins de 15 minutes.
- Installation en **une commande**, tests lancés en **une commande**.
- **CI à chaque pull request** : lint, tests du web, du serveur et du mobile, build. Une PR dont le pipeline échoue ne peut pas être mergée.
- **Un tableau GitHub Projects lié au dépôt**, des issues reliées aux PR, un historique qui montre qui a fait quoi.
- Livrable : « Dépôt GitHub propre, avec les fichiers indispensables, les tests, le pipeline CI/CD et le tableau GitHub Projects ».

## Options étudiées

### Option A — Multi-repo (un dépôt par composant)
Découpage initialement envisagé : `kub`, `ansible`, `db`, `api-public`, `api-internal`, `front`, `mobile`.

- ✅ Isolation forte, cycle de release indépendant par composant.
- ✅ Proche d'une organisation microservices « industrielle ».
- ❌ Le test du nouvel arrivant devient difficile : 7 dépôts à cloner, dans le bon ordre, avec des versions compatibles.
- ❌ Une fonctionnalité qui touche l'API et le front se transforme en plusieurs PR à synchroniser.
- ❌ Le code métier partagé (moteur de tournoi, barème) doit être dupliqué ou publié comme crate versionnée.
- ❌ 7 fois les fichiers indispensables (README, CONTRIBUTING, LICENSE, CHANGELOG, templates…) et 7 configurations CI.
- ❌ Moins lisible pour le jury, qui attend un dépôt.

### Option B — Monorepo
- ✅ Un clone, un README, un `docker compose up`, une commande de test : le test du nouvel arrivant devient réaliste.
- ✅ Une PR atomique peut modifier API, front et migrations ensemble.
- ✅ Le domaine Rust est partagé via un Cargo workspace, sans publication.
- ✅ Un seul tableau GitHub Projects, une seule protection de branche, un seul jeu de fichiers indispensables.
- ❌ La CI doit être découpée par chemins pour rester rapide.
- ❌ Discipline nécessaire pour garder une arborescence claire.

## Décision

**Nous utilisons un monorepo unique.** La séparation logique en composants est conservée sous forme de dossiers, et chaque service reste publié comme une image Docker indépendante.

Arborescence cible :

```
epickem/
├── backend/                 # Cargo workspace
│   ├── crates/
│   │   ├── domain/          # moteur de tournoi, barème, résolution Pick'em (pur, sans I/O)
│   │   ├── connectors/      # trait TournamentConnector + connecteur start.gg
│   │   ├── api-public/      # binaire : HTTP + WebSocket pour web et mobile
│   │   ├── api-internal/    # binaire : calculs, résolution, sync des connecteurs
│   │   └── simulator/       # binaire : génération et déroulement de tournois
│   └── Cargo.toml
├── db/                      # changelogs Liquibase + Dockerfile
├── web/
├── mobile/
├── loadtest/                # scénarios k6
├── deploy/
│   ├── helm/epickem/        # chart : app + PostgreSQL + Redis + ingress
│   └── ansible/             # provisioning VM, k3s, déploiement
├── docs/
├── .github/
│   ├── workflows/
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
├── docker-compose.yml
├── .env.example
└── README.md
```

## Conséquences

- **Positives :** onboarding en une commande, PR atomiques, code métier partagé sans duplication, un seul point d'entrée pour le jury.
- **Négatives / coûts acceptés :** la CI doit filtrer par chemins (`paths:` dans GitHub Actions) pour ne pas tout reconstruire à chaque PR ; un job « garde-fou » agrégé est nécessaire pour que les checks requis restent stables sur la branche protégée.
- **Actions à mener :**
  - Créer l'arborescence et le Cargo workspace.
  - Écrire les workflows CI par composant + un job `ci-ok` requis par la protection de branche.
  - Tagger les images avec le SHA du commit et la version semver du dépôt.
