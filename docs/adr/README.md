# Architecture Decision Records (ADR)

Ce dossier trace les décisions d'architecture du projet : contexte, options étudiées, choix retenu et conséquences. Un ADR n'est jamais réécrit après acceptation : s'il est remis en cause, un nouvel ADR le remplace et l'ancien passe au statut « Remplacé par ADR-XXX ».

## Statuts

- **Proposé** : en discussion dans l'équipe.
- **Accepté** : décision en vigueur.
- **Remplacé** : décision abandonnée au profit d'un ADR plus récent.

## Index

| N° | Titre | Statut |
|----|-------|--------|
| [001](001-monorepo.md) | Monorepo unique pour tout le projet | Proposé |
| [002](002-api-publique-interne-bus-redis.md) | Séparation API publique / API interne et bus d'événements Redis | Accepté |
| [003](003-abstraction-connecteurs.md) | Abstraction des sources de tournois externes (connecteurs) | Accepté |
| [004](004-simulateur.md) | Simulateur en Rust et tests de charge k6 | Proposé |
| [005](005-deploiement.md) | Docker Compose en local, Kubernetes (k3s) + Helm + Ansible en ligne | Accepté |
| [006](006-migrations-liquibase.md) | Migrations de base de données avec Liquibase, publiées en image Docker | Accepté |
| [007](007-gestion-des-secrets.md) | Gestion des secrets | Accepté |
| [008](008-couche-infra-et-cache.md) | Crate `infra` partagée et cache Redis des requêtes SQL | Proposé |
| [009](009-authentification-jwt-et-roles.md) | Authentification par JWT d'accès, jeton de rafraîchissement opaque et rôles | Proposé |
| [010](010-api-publique-actix-web.md) | `api-public` sur actix-web | Proposé |

## Créer un nouvel ADR

1. Copier [`template.md`](template.md) en `NNN-titre-court.md` (numéro suivant).
2. Ouvrir une pull request liée à l'issue correspondante, avec le statut « Proposé ».
3. Passer le statut à « Accepté » une fois la PR relue et validée par l'équipe.
4. Mettre à jour l'index ci-dessus.
