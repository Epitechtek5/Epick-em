# Démarrage local

Une commande lance toute la plateforme avec des données de démonstration :

```sh
git clone <url-du-dépôt> epickem && cd epickem
make demo
```

`make demo` crée `.env` depuis `.env.example` (s'il n'existe pas), construit et lance PostgreSQL, Redis, les migrations Liquibase, api-public, api-internal et le web (`docker compose up --build -d`), attend que l'API réponde, puis joue le script de démonstration [`seed_demo.py`](../seed_demo.py).

Durées mesurées sur un poste de développement (Linux, 12 cœurs) : **≈ 6 min 30** au premier lancement (build Rust et web sans cache), **4 s** pour relancer `make demo` sur une base déjà remplie, **27 s** pour `make reset` une fois les images construites.

## Prérequis

| Outil | Pour | Version |
|---|---|---|
| Docker + Compose v2 | `make demo`, `make up` | Docker 24+ |
| `make`, `curl`, `python3` | scripts du Makefile, données de démo | Python 3.10+ |
| Rust stable | `make test-backend`, `make lint-backend` | stable |
| Node.js 24 + npm | `make test-web`, `make test-mobile` | voir `mobile/.node-version` |

Aucun compte, secret ni image privée n'est nécessaire : les valeurs de `.env.example` suffisent en local.

## Ce que contient la démo

| Élément | Accès |
|---|---|
| Site web | http://localhost:3000 (`WEB_PORT`) |
| API publique | http://localhost:8080 (`API_PUBLIC_PORT`), aussi via http://localhost:3000/api |
| Compte administrateur | `seed_admin@example.test` |
| Comptes joueurs | `alice_test@example.test`, … (liste dans `.demo/seed-manifest.json`) |
| Mot de passe de tous les comptes | `Password1234!` |

Les comptes sont créés par l'API (`/register`, hachage Argon2), puis vérifiés et, pour l'administrateur, promus directement en base. Le script crée ensuite des jeux, des équipes et des tournois `DEMO - …` dans plusieurs états (brouillon, en cours avec des matchs terminés et des points attribués, annulé ; individuels et par équipes). Ce script tient lieu de **simulateur** (ADR-004) : il passe par la vraie logique métier (inscriptions, cycle de vie des matchs, calcul des points). Le manifeste `.demo/seed-manifest.json` récapitule ce qui a été créé (sans mot de passe ni jeton).

Ces comptes et ce mot de passe sont **publics** : ils n'existent que dans une base locale ou dans l'environnement de démonstration, jamais en production (le script refuse une URL non locale sans `--demo-environment`).

## Commandes

| Commande | Effet |
|---|---|
| `make demo` | plateforme + données de démo (idempotent : ne recrée rien si la démo existe déjà) |
| `make up` / `make down` | lancer / arrêter la plateforme sans toucher aux données |
| `make seed` | (re)jouer seulement les données de démo |
| `make reset` | **supprime la base locale** (volume Docker) et relance `make demo` |
| `make logs` | 200 dernières lignes de journaux de chaque service |
| `make test` | tous les tests : backend (`cargo test`), web et mobile (Vitest/Jest) ; `make -k test` continue après un échec |
| `make lint` | rustfmt + clippy, ESLint + typecheck web, ESLint mobile |

`make test` n'a besoin d'aucun service lancé : les tests backend utilisent le stockage en mémoire ; ceux qui demandent PostgreSQL sont marqués `#[ignore]` et se lancent à part avec `DATABASE_URL` (voir `backend/crates/api-public/tests/postgres.rs`). Les dépendances npm sont installées (`npm ci`) au premier lancement.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `port is already allocated` | un autre service occupe 3000, 5432, 6379, 8080 ou 8081 | changer `WEB_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, `API_PUBLIC_PORT` ou `API_INTERNAL_PORT` dans `.env`, puis `make demo` |
| `L'API ne répond pas` après `make up` | migration ou démarrage en échec | `make logs` (services `migrations` et `api-public`) ; une base locale incohérente se répare avec `make reset` |
| `partial seed` | un lancement précédent a été interrompu pendant le remplissage | `make reset` |
| `permission denied … docker.sock` | l'utilisateur n'est pas dans le groupe `docker` | `sudo usermod -aG docker $USER`, puis se reconnecter |
| Build très lent sur Mac ARM / Windows | build Rust dans une VM Docker | normal au premier lancement ; les suivants réutilisent le cache |
| `make test-web` échoue sur `npm ci` | version de Node trop ancienne | installer Node 24 |

Pour repartir de zéro et libérer l'espace disque : `docker compose down -v --remove-orphans`, puis `docker image prune -f`.

## Et en ligne ?

La même plateforme tourne sur un cluster k3s (démo publique et production) : voir [exploitation/deploiement.md](exploitation/deploiement.md).
