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
| Élimination simple : tableau d'une puissance de deux sans exempt, exempts aux meilleures têtes de série sinon, têtes de série qui se rencontrent le plus tard possible ; parcours jusqu'au champion | crate `domain` (`bracket.rs`, `seeding.rs`), `tests/generation.rs` (`single_elimination_with_byes_plays_to_a_champion`) |
| Double élimination : forme du tableau pour toute taille, perdants envoyés au tableau des perdants, grande finale et « reset » joué ou annulé | `bracket.rs`, `tests/generation.rs` (`double_elimination_sends_losers_down_and_plays_the_reset`, `the_reset_is_cancelled_when_the_winners_champion_wins_the_grand_final`) |
| Suisse : groupes de score, revanches évitées, exempt au dernier qui n'en a pas eu pour un nombre impair, appariement impossible signalé ou revanche acceptée sur demande | `swiss.rs`, `tests/generation.rs` (`swiss_rounds_follow_the_standings_without_rematches`, `swiss_reports_impossible_pairings_and_accepts_rematches_on_request`) |
| Têtes de série manuelles, aléatoires ou par classement ; tirage en serpent des groupes | `seeding.rs`, `tests/generation.rs` (`seeds_are_manual_random_or_ranking_based`, `a_manual_seed_order_places_the_bracket`) |
| Départages ordonnés : points, confrontation directe, différence de manches, Buchholz, ordre d'inscription en dernier ; élimination classée par tour atteint | `standings.rs`, `standing.rs`, `tests/generation.rs` (`a_round_robin_pool_plays_everyone_once_and_head_to_head_breaks_ties`) |
| Séries BO3/BO5 : majorité des manches, saisie directe (`games_won`) ou partie par partie, le vainqueur avance | `standings.rs`, `tests/generation.rs` (`series_need_a_decided_score_and_keep_rounds_apart_from_games`, `a_generated_series_played_game_by_game_advances_its_winner`), `tests/match_games.rs` |
| Forfait : l'absent perd sans statistique ni manche, son adversaire avance | `matches.rs` (`settle`), `tests/generation.rs` (`a_forfeit_sends_the_opponent_through`) |
| Génération idempotente, même sous appels concurrents ; export puis réimport d'un tableau généré | `tests/generation.rs` |

### Concurrence et idempotence (PostgreSQL réel)

`backend/crates/api-public/tests/concurrency.rs`, ignoré par défaut :

- **matchs d'une étape terminés en même temps** : chaque participant garde les points de tous ses
  matchs. Ce test a révélé une perte de points (6 matchs terminés ensemble → 2 comptés) ; corrigé
  en verrouillant l'étape pendant la fin d'un match et en recalculant son total en base ;
- **le même match terminé plusieurs fois en même temps** : une seule fin compte, les autres
  reçoivent `409` ;
- **inscriptions simultanées au-delà de la capacité** : exactement `max_participants` réussissent.

### Non couvert, faute de fonctionnalité

Les résultats sont saisis par un administrateur : la confirmation des résultats par les
participants et les litiges n'existent pas encore dans le dépôt. Leurs tests sont à écrire avec
ces fonctionnalités.

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

This PR is partial validation of #175. It must not close that issue or claim manual accessibility approval until the evidence below is recorded. Automated axe and component tests do not satisfy this gate.

| Required evidence | Status | Record to attach |
|---|---|---|
| Keyboard-only web journey | Pending | Commit, browser/version, focus order, visible focus, dialog escape, failures |
| NVDA + Firefox | Pending | NVDA/browser versions, actual announcements, headings/landmarks/table navigation, errors |
| VoiceOver + Safari | Pending | macOS/Safari versions and actual spoken output on the same journey |
| Android TalkBack | Pending | APK commit, device/API and TalkBack versions, reading order, roles, target sizes, 200% text |
| iOS VoiceOver | Pending | Build commit, device/iOS version and the same checks |
| Light/dark contrast | Pending | Measured foreground/background pairs and WCAG ratios |

An audit record must identify the tested revision, date, tester, scenario, expected and observed behavior, and linked defects. “Pending” may only become “Pass” after exercising the named assistive technology; inspecting ARIA attributes is not equivalent. Result confirmation and dispute tests also remain dependent on the missing features. Keep #175 open until these requirements are completed.


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
