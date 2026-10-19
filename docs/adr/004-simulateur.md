# ADR-004 — Simulateur en Rust et tests de charge k6

- **Statut :** Proposé
- **Date :** 2026-10-19
- **Décideurs :** équipe backend/devops (à valider par l'équipe)
- **Issue liée :** #…

## Contexte

Le sujet attend un simulateur qui remplit deux rôles distincts :

1. **Générer et jouer :** créer des joueurs, des équipes et des spectateurs fictifs, jouer les matchs avec des statistiques réalistes et produire des pronostics, **en accéléré ou en temps réel**. Il sert à la démonstration (trois tournois internes dont une ronde suisse, une double élimination et une FFA) et au **test du nouvel arrivant**, qui doit lancer « la plateforme avec un tournoi simulé » en moins de 15 minutes.
2. **Charger :** des milliers de spectateurs qui pronostiquent pendant un même match, avec des résultats documentés (capacité, délai de mise à jour des classements).

Autres contraintes : aucune donnée personnelle réelle ; les tests doivent passer **sans connexion** ; la soutenance comprend un **tournoi simulé en direct**.

Deux pistes ont été proposées : un scénario k6, ou un scénario piloté par une IA, pouvant cibler l'environnement local ou en ligne.

## Options étudiées

### Option A — k6 seul
- ✅ Excellent outil de charge, scripts simples, métriques intégrées.
- ❌ Ce n'est pas un générateur de tournoi : jouer une ronde suisse ou une FFA avec des stats cohérentes en JavaScript k6 est laborieux.

### Option B — Agents IA
- ✅ Comportements variés, démonstration originale.
- ❌ **Non déterministe** : la démo et les tests changent à chaque lancement, risqué en soutenance.
- ❌ Nécessite une **clé d'API et le réseau**, incompatible avec le test du nouvel arrivant hors ligne.
- ❌ Coûteux et lent pour des milliers d'acteurs.

### Option C — Simulateur Rust seedé + scénarios k6 pour la charge
- ✅ Déterministe (seed) : démo reproductible, utilisable en test d'intégration.
- ✅ Réutilise les types du crate `domain`.
- ✅ k6 utilisé là où il excelle.
- ❌ Deux outils à maintenir.

## Décision

**Nous retenons l'option C.**

### `simulator` (binaire Rust du workspace)

- Passe par **l'API publique**, comme un vrai client : il teste donc la chaîne complète (authentification, permissions, verrouillage, événements, WebSocket).
- Cible configurable : `--target http://localhost:8080` ou l'URL en ligne.
- `--seed` pour un déroulement reproductible ; `--speed` pour le mode accéléré (ex. `x60`) ou `realtime`.
- Scénarios prédéfinis : `demo` (les trois formats internes exigés), `swiss`, `double-elim`, `ffa`, `quick` (petit tournoi pour le nouvel arrivant).
- Génère des identités **fictives** (pseudos, équipes) et des statistiques réalistes selon le jeu (personnages pondérés, kills, buts, MVP).
- Lancé automatiquement par `docker compose` en profil `demo`.

### `loadtest/` (scénarios k6)

- Se branchent sur un tournoi créé par le simulateur.
- Scénario principal : N spectateurs virtuels connectés en WebSocket, qui pronostiquent juste avant le verrouillage d'un match ; mesure du délai entre la saisie du résultat et la réception de la mise à jour du classement.
- Résultats exportés et documentés dans `docs/exploitation/tests-de-charge.md`.

### IA

L'IA n'est pas utilisée dans le simulateur de base. Elle reste une **option bonus** (génération de noms, ou bonus « prédictions assistées »), désactivée par défaut.

## Conséquences

- **Positives :** démo identique à chaque lancement ; test du nouvel arrivant possible sans réseau ni secret ; tests de charge reproductibles.
- **Négatives / coûts acceptés :** génération de statistiques « réalistes » à concevoir par jeu ; scripts k6 à maintenir en phase avec l'API (dépendre de la spec OpenAPI limite le risque).
- **Actions à mener :**
  - Scénario `quick` disponible dès la première version, pour valider le test du nouvel arrivant tôt.
  - Job CI de non-régression : `simulator --scenario quick --seed 42` contre l'environnement lancé en CI.
  - Campagne de charge avant le follow-up de décembre, puis avant la soutenance.
