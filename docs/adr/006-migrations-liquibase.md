# ADR-006 — Migrations de base de données avec Liquibase, publiées en image Docker

- **Statut :** Accepté
- **Date :** 2026-10-19
- **Décideurs :** équipe backend/devops
- **Issue liée :** #…

## Contexte

La base PostgreSQL est partagée par api-public et api-internal. Son schéma évolue tout au long du projet et doit être appliqué de façon identique :

- en local (Docker Compose), pour le nouvel arrivant ;
- en CI, pour les tests d'intégration ;
- en ligne (Kubernetes), à chaque déploiement.

Le sujet exige aussi un **modèle de données documenté** (schéma des entités et dictionnaire des champs).

## Options étudiées

### Option A — Migrations embarquées dans une API (sqlx migrate, refinery)
- ✅ Natif Rust.
- ❌ Deux binaires partagent la base : lequel migre ? Risque de migrations concurrentes au démarrage.

### Option B — Liquibase publié en release GitHub
- ✅ Outil indépendant des services, historique et rollback.
- ❌ Il faut télécharger l'artefact à part, en local comme en CI : une étape de plus pour le nouvel arrivant.

### Option C — Liquibase publié en image Docker
- ✅ Même artefact partout : service one-shot dans Compose, Job Helm en Kubernetes, étape en CI.
- ✅ Aucune installation locale de Liquibase ni de Java.

## Décision

**Nous retenons l'option C.**

- Dossier `db/` : `changelog/db.changelog-master.yaml` incluant un fichier par changement (`NNNN-description.yaml`), plus un `Dockerfile` basé sur l'image officielle `liquibase/liquibase` qui copie les changelogs.
- Image publiée sur GitHub Container Registry, versionnée comme les autres services.
- **Docker Compose :** service `migrations` exécuté avant les API (`depends_on` avec `condition: service_completed_successfully`).
- **Kubernetes :** Job Helm en hook `pre-install` / `pre-upgrade` : les API ne sont mises à jour qu'après une migration réussie.
- **CI :** les tests d'intégration démarrent PostgreSQL, appliquent l'image de migration, puis lancent les tests.
- Les données de démonstration ne sont **pas** dans les changelogs : elles sont produites par le simulateur (ADR-004).

### Règles

- Un changeset n'est jamais modifié une fois mergé : on en ajoute un nouveau.
- Chaque changeset a un `rollback` explicite quand c'est possible.
- Changements compatibles avec la version précédente du code (ajout de colonne nullable, puis remplissage, puis contrainte) pour permettre les rolling updates.

## Conséquences

- **Positives :** un seul mécanisme de migration, reproductible partout ; ordre de déploiement garanti.
- **Négatives / coûts acceptés :** un outil JVM dans la chaîne (uniquement dans son conteneur) ; les requêtes Rust doivent rester alignées sur le schéma (vérification en CI via les tests d'intégration).
- **Actions à mener :**
  - Créer le changelog initial à partir du modèle de données.
  - Générer le schéma des entités pour la documentation (ex. `tbls` ou SchemaSpy sur la base migrée en CI).
