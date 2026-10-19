# ADR-002 — Séparation API publique / API interne et bus d'événements Redis

- **Statut :** Accepté
- **Date :** 2026-10-19
- **Décideurs :** équipe backend/devops
- **Issue liée :** #…

## Contexte

Le backend doit à la fois :

- servir le front web, l'application mobile et le dashboard en direct (lectures, pronostics, Pick'em, administration, temps réel) ;
- exécuter des traitements lourds ou asynchrones : avancement des arbres, résolution des pronostics et Pick'em, **recalcul en cascade** après correction d'un score, synchronisation régulière des tournois importés depuis start.gg.

Contraintes du sujet :

- Mise à jour **en temps réel** de l'arbre, des pronostics et des classements après chaque résultat.
- **Verrouillage des pronostics sur l'horloge du serveur** : aucune modification après le début d'un match.
- **Tests de charge** : des milliers de spectateurs qui pronostiquent pendant un même match.
- La plateforme reste utilisable quand start.gg ne répond pas.

## Options étudiées

### Option A — API monolithique unique
- ✅ Simple à déployer.
- ❌ Les calculs lourds (recalcul en cascade, sync start.gg) concurrencent les requêtes des spectateurs.
- ❌ Impossible de dimensionner séparément le trafic utilisateur et les traitements.

### Option B — API publique + API interne, communication HTTP directe
- ✅ Séparation des responsabilités.
- ❌ Couplage synchrone : si l'interne est indisponible, l'écriture d'un résultat échoue ou se perd.

### Option C — API publique + API interne, communication par événements via Redis
- ✅ Découplage : l'API publique répond vite, l'interne traite à son rythme.
- ✅ Redis est déjà présent pour le cache, pas de nouvelle brique.
- ✅ Les événements peuvent être rejoués (recalcul, reprise après panne).
- ❌ Cohérence à terme : un court délai entre la saisie et la mise à jour des classements.

## Décision

**Nous retenons l'option C.**

### Responsabilités

| Composant | Rôle |
|---|---|
| **api-public** | Tout ce qui est lu ou écrit par le front et le mobile : authentification, administration, inscriptions, saisie et déclaration des scores, pronostics et Pick'em, lectures, **WebSocket** temps réel. |
| **api-internal** | Tout le reste : avancement des arbres, qualifications entre étapes, résolution des pronostics et Pick'em, recalcul en cascade, classements, synchronisation des connecteurs. Pas d'exposition sur l'ingress. |
| **crate `domain`** | Logique métier pure, partagée par les deux binaires (pas d'I/O, entièrement testable). |

### Communication

```
front/mobile ──HTTP/WS──▶ api-public ──écrit──▶ PostgreSQL
                              │
                              └─ XADD "events" (match.result, score.corrected…) ──▶ Redis Streams
                                                                                        │
                          api-internal ◀── XREADGROUP (consumer group) ────────────────┘
                              │   (avancement arbre, résolution, recalcul, classements)
                              │
                              └─ PUBLISH "live.*" ──▶ Redis Pub/Sub ──▶ toutes les instances api-public ──WS──▶ clients
```

- **Redis Streams** pour les événements métier : persistés, consommés via un consumer group avec acquittement. Un redémarrage de l'API interne ne perd aucun événement.
- **Redis Pub/Sub** pour la diffusion temps réel : éphémère, chaque instance d'api-public relaie à ses propres clients WebSocket. Permet de scaler api-public horizontalement.
- **Redis comme cache** : classements, arbres rendus, données start.gg.

### Règles

1. **Le verrouillage des pronostics est appliqué par api-public**, au moment de l'écriture, en comparant l'heure de début du match (en base) à l'horloge serveur. L'API interne ne décide jamais de l'acceptation d'un pronostic.
2. **Les traitements de l'API interne sont idempotents** : rejouer un événement produit le même état (pas de points comptés deux fois). Les points sont recalculés à partir de l'état, et non incrémentés.
3. **Chaque événement porte un identifiant unique et une version de l'entité concernée**, ce qui permet d'ignorer les doublons et de détecter un recalcul nécessaire.
4. **Les corrections de score** produisent un événement `score.corrected` qui déclenche le recalcul en cascade (arbre, qualifiés, points de tous les spectateurs) et une entrée dans le **journal d'audit**.
5. Les mises à jour WebSocket sont regroupées (débounce court) pour ne pas submerger les clients ni les lecteurs d'écran.

## Conséquences

- **Positives :** api-public reste réactive sous charge ; les calculs lourds sont isolés et rejouables ; scalabilité horizontale d'api-public.
- **Négatives / coûts acceptés :** cohérence à terme (délai de mise à jour à mesurer pendant les tests de charge) ; un contrat d'événements à documenter et à versionner.
- **Actions à mener :**
  - Définir le schéma des événements dans un module partagé (`domain::events`) et le documenter.
  - Tests : idempotence de chaque handler, recalcul en cascade, rejeu complet d'un tournoi.
  - Mesurer le délai « saisie du résultat → classement mis à jour » lors des tests de charge.
