# ADR-008 — Crate `infra` partagée et cache Redis des requêtes SQL

- **Statut :** Proposé
- **Date :** 2026-10-20
- **Décideurs :** équipe backend/devops
- **Issue liée :** #12

## Contexte

api-public et api-internal accèdent tous deux à PostgreSQL et à Redis (ADR-002). Chacun doit :

- lire la configuration de connexion (`DATABASE_URL`, `REDIS_URL`) et ouvrir les connexions au démarrage ;
- mettre en cache des lectures fréquentes : le sujet prévoit des **milliers de spectateurs** sur un même match, et ADR-002 désigne Redis comme cache (classements, arbres rendus, données start.gg).

Contraintes :

- la crate `domain` reste **sans I/O** : le code de connexion ne peut pas y vivre ;
- le cache ne doit pas devenir un point de panne : la plateforme reste utilisable si Redis est indisponible ;
- une donnée en cache ne doit pas rester périmée indéfiniment, y compris quand une invalidation échoue ;
- le code doit rester testable sans Redis.

## Options étudiées

### Option A — Connexions et cache écrits dans chaque binaire
- ✅ Aucune crate supplémentaire.
- ❌ Code dupliqué entre api-public et api-internal ; deux stratégies de cache risquent de diverger.

### Option B — Crate `infra` partagée, cache appelé à la main
- ✅ Connexions écrites une seule fois.
- ❌ Chaque handler réimplémente « lire le cache, sinon la base, puis écrire le cache », sérialisation et gestion d'erreurs comprises : oublis d'invalidation et TTL manquants probables.

### Option C — Crate `infra` partagée, avec une couche qui associe une requête sqlx à une entrée de cache
- ✅ Connexions et stratégie de cache écrites une seule fois.
- ✅ Le handler ne fournit que la clé, le TTL et la requête.
- ✅ Le cache passe par un trait : implémentation en mémoire pour les tests.
- ❌ Une crate et une abstraction de plus à maintenir.

## Décision

**Nous retenons l'option C.**

### Contenu de la crate `infra`

| Élément | Rôle |
|---|---|
| `Config::from_env()` | `DATABASE_URL`, `REDIS_URL`, `DATABASE_MAX_CONNECTIONS` (optionnel, 10 par défaut). |
| `infra::connect()` | Ouvre le pool PostgreSQL (sqlx) et Redis (`ConnectionManager`, reconnexion automatique). |
| trait `Cache` | `get` / `set` / `delete` sur des octets, utilisable en `Arc<dyn Cache>`. Implémenté par `RedisCache` et `MemoryCache` (tests). |
| `CachedDb` | Pool + cache. Associe une requête sqlx à une clé de cache. |
| `Ttl` | Durée de vie d'une entrée : secondes entières, jamais nulle. |

### Stratégie de cache (`CachedDb`)

- **Lecture** (`read`, `read_optional`) : cache, sinon base puis mise en cache. `read_optional` ne met pas un résultat `None` en cache, pour qu'une ligne créée ensuite soit trouvée immédiatement.
- **Écriture** (`write`) : base d'abord, puis le résultat remplace l'entrée en cache.
- **Suppression** (`delete`) : base d'abord, puis invalidation des clés données. `invalidate` invalide sans requête (listes, agrégats).
- Valeurs sérialisées en JSON.

### Règles

1. **Le cache est une optimisation, jamais une source de vérité.** Une erreur de cache (Redis indisponible, valeur illisible) est journalisée puis ignorée : la base répond. Seules les erreurs sqlx remontent à l'appelant.
2. **TTL obligatoire.** Toute écriture en cache exige un `Ttl` ; un TTL nul est refusé (erreur de compilation pour une constante). Le TTL borne la durée d'une valeur périmée après une invalidation ratée : le choisir en fonction de la fraîcheur attendue de la donnée.
3. **Démarrage strict.** Les services s'arrêtent si PostgreSQL ou Redis est injoignable au démarrage ; Compose et Kubernetes les redémarrent. Une fois démarré, la perte de Redis ne bloque plus les requêtes (règle 1).
4. Les binaires dépendent de `infra` pour toute I/O de base ou de cache ; `domain` reste pure.

## Conséquences

- **Positives :** une seule implémentation des connexions et du cache ; handlers courts ; panne de Redis sans interruption de service ; tests sans Redis grâce à `MemoryCache`.
- **Négatives / coûts acceptés :**
  - cohérence à terme : entre l'écriture en base et la mise à jour du cache, une lecture concurrente peut remettre une ancienne valeur en cache, jusqu'à l'expiration de son TTL ;
  - pas de protection contre le rechargement simultané d'une clé expirée (*cache stampede*) ;
  - les tests contre un vrai Redis/PostgreSQL sont ignorés par défaut (`cargo test -p infra -- --ignored`) : la CI backend n'a pas encore ces services.
- **Actions à mener :**
  - définir une convention de nommage des clés (préfixe par entité, version du format) ;
  - fixer les TTL par type de donnée lors de l'implémentation des endpoints ;
  - ajouter PostgreSQL et Redis au job de test backend pour exécuter les tests ignorés ;
  - mesurer le taux de succès du cache pendant les tests de charge.
