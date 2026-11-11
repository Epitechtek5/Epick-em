# Qualité, accessibilité et performance

Où sont les tests, ce qu'ils garantissent, comment les lancer, et ce qui n'est pas encore couvert.
Les mesures de charge sont dans [`exploitation/tests-de-charge.md`](exploitation/tests-de-charge.md).

## Lancer les tests

| Partie | Commande | Notes |
|---|---|---|
| Backend | `cd backend && cargo test --workspace` | store en mémoire, sans réseau |
| Backend sur PostgreSQL | `DATABASE_URL=postgres://… cargo test --workspace -- --ignored` | base migrée par Liquibase (`db/`) ; les tests créent des noms uniques et n'effacent rien |
| Web | `cd web && npm test` | Vitest + Testing Library, axe-core |
| Mobile | `cd mobile && npm test` | Jest + React Native Testing Library |
| Charge | `loadtest/run-local.sh` | environnement isolé et jetable, voir *Tests de charge* |

## Moteur de compétition

Tests unitaires déterministes (`backend/crates/api-public/src/*.rs`, modules `tests`) et parcours
HTTP (`backend/crates/api-public/tests/`).

| Règle | Où |
|---|---|
| Chaînage des étapes (capacités, qualifiés, dernière étape à un qualifié), réglages invalides champ par champ | `steps.rs` (`a_chain_reports_every_break`, `step_settings_are_checked_field_by_field`), `tests/steps.rs` |
| Tirage des groupes équilibré, chaque participant une fois | `steps.rs` (`the_draw_deals_every_participant_once_in_balanced_groups`) |
| Barème (linéaire, table), points, rangs et issues déduits, ex æquo, classements par groupe et de tournoi, agrégation d'équipe | `ranking.rs`, `matches.rs`, `steps.rs`, `tests/tournaments.rs` |
| Cycle de vie : verrouillage du barème et des réglages, transitions de statut, match annulé définitif, clôture automatique de l'étape | `tests/tournaments.rs`, `tests/steps.rs`, `tests/matches.rs` |
| Élimination : le vainqueur passe au match suivant ; tableau à mi-parcours | `tests/matches.rs` (`the_winner_moves_on_in_an_elimination_bracket`) |
| Import ↔ saisie : un résultat importé avec ses seules statistiques reçoit les mêmes points, rangs et issues qu'une saisie, et la suite donne les mêmes totaux | `tests/matches.rs` (`imported_results_follow_the_same_rules_as_manual_ones`) |
| Export puis réimport sans perte (JSON et CSV) ; fichiers invalides refusés avant toute écriture | `tests/steps.rs`, `tests/matches.rs` |
| Tournois externes : correction de résultat détectée une seule fois, rejeu idempotent | crate `connectors` (`sync/tests.rs`, `tests/json_file.rs`) |

### Concurrence et idempotence (PostgreSQL réel)

`backend/crates/api-public/tests/concurrency.rs`, ignoré par défaut :

- **matchs d'une étape terminés en même temps** : chaque participant garde les points de tous ses
  matchs. Ce test a révélé une perte de points (6 matchs terminés ensemble → 2 comptés) ; corrigé
  en verrouillant l'étape pendant la fin d'un match et en recalculant son total en base ;
- **le même match terminé plusieurs fois en même temps** : une seule fin compte, les autres
  reçoivent `409` ;
- **inscriptions simultanées au-delà de la capacité** : exactement `max_participants` réussissent.

### Non couvert, faute de fonctionnalité

Le dépôt ne contient pas encore : génération automatique des tableaux (élimination simple ou
double, exempts pour un nombre de participants qui n'est pas une puissance de deux), appariements
suisses et évitement des revanches, têtes de série automatiques, critères de départage ordonnés
appliqués au classement (le champ `tiebreak` est enregistré mais le classement départage par
points puis ordre d'inscription), confirmation des résultats par les participants, litiges et
forfaits. Les tests correspondants sont à écrire avec ces fonctionnalités (#157, #162).

## Accessibilité

### Contrôles automatiques

- **Web** (`web/src/a11y.test.tsx`) : axe-core, règles WCAG 2.1 A et AA et bonnes pratiques, sur
  connexion, inscription, mot de passe oublié, accueil, liste et détail d'un tournoi, étape de
  poules, tableau d'élimination et détail d'un match. Ce test a révélé et fait corriger deux
  défauts : des listes de définitions mal formées (`FactTile`) sur les pages tournoi, étape et
  match, et deux régions homonymes « Groupe 1 » sur la page d'une étape.
- **Mobile** (`mobile/__tests__/accessibility.test.tsx`) : sur les écrans de connexion,
  inscription, mot de passe oublié et nouveau mot de passe, chaque élément actionnable expose un
  rôle et un nom accessibles, chaque champ un libellé, et l'erreur de validation est annoncée.
- Les tests d'écran existants interrogent l'interface par rôle et par nom accessible
  (`getByRole`, `getByLabelText`), ce qui casse dès qu'un libellé disparaît.

jsdom ne calcule ni la mise en page ni les couleurs : **contraste, taille des cibles tactiles,
ordre de focus visuel et rendu réel des lecteurs d'écran ne sont pas vérifiés automatiquement.**

### Audit manuel

**Non réalisé dans le cadre de cette PR** : aucun résultat d'audit manuel n'est revendiqué ici.
Protocole à suivre et à consigner dans ce document (date, version, navigateur ou appareil,
technologie d'assistance, résultat par point, anomalies ouvertes) :

1. **Clavier (web)** : tout le parcours connexion → tournoi → étape → match au clavier seul ;
   focus toujours visible, ordre logique, pas de piège, `Échap` ferme les dialogues.
2. **Lecteur d'écran (web)** : NVDA + Firefox et VoiceOver + Safari ; titres de page, repères,
   tableaux de classement (en-têtes lus), messages d'erreur annoncés, tableau d'élimination
   navigable.
3. **Mobile** : TalkBack (Android) et VoiceOver (iOS) sur les mêmes parcours ; ordre de lecture,
   rôles, cibles d'au moins 44 × 44 points, texte agrandi à 200 %.
4. **Contraste** : thèmes clair et sombre, texte et composants d'interface (WCAG 1.4.3 et 1.4.11).

## Performance

Scénarios k6 dans `loadtest/`, résultats mesurés, seuils, environnement et limites dans
[`exploitation/tests-de-charge.md`](exploitation/tests-de-charge.md).
