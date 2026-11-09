# web

Front web d'Epick'em : React 19 + TypeScript, [Vite](https://vite.dev), [Tailwind CSS v4](https://tailwindcss.com) et [shadcn/ui](https://ui.shadcn.com) (preset `b5vnF8h2A` : base Radix UI, style nova, thème violet, icônes Hugeicons, police Inter).

## Commandes

Prérequis : Node.js 22+.

```sh
npm ci            # installe les dépendances (lockfile)
npm run dev       # serveur de dev sur http://localhost:5173
npm run lint      # oxlint
npm test          # vitest (une seule exécution)
npm run build     # typecheck + build de production dans dist/
```

## Structure

| Dossier | Contenu |
|---|---|
| `src/pages/` | Écrans : `LoginPage`, `RegisterPage`, `HomePage` (zone authentifiée), `GamesPage`, `GameDetailsPage`, `GameEditorPage`, `GameTransferPage`, `StatsPage`, `StatEditorPage`, `StatTransferPage`, `TeamsPage`, `TeamDetailsPage`, `TeamEditorPage`, `TeamTransferPage`, `TournamentTeamsPage`, `TournamentTeamDetailsPage`, `TournamentTeamEditorPage`, `TournamentTeamCopyPage`, `TournamentsPage`, `TournamentDetailsPage`, `TournamentEditorPage`, `TournamentTransferPage`, `StepDetailsPage`, `StepEditorPage`, `StepBracketPage`, `MatchDetailsPage`, `MatchEditorPage`, `NotFoundPage` |
| `src/components/` | `ui/` (shadcn, liste filtrable `searchable-select`), `form/` (champ accessible, résumé d'erreurs), `layout/` (shell, en-tête), `home/` (blocs du tableau de bord), `auth/` (routes protégée, invité, admin), `games/` (carte, image, formulaire), `stats/` (formulaire, section « statistiques » d'un jeu), `teams/` (carte, photo avec repli, formulaire, en-tête de fiche, section membres partagée entre équipes globales et de tournoi), `tournaments/` (carte, statut en texte, formulaire, cycle de vie, inscrits, barème, classements), `steps/` (section de la fiche du tournoi, statuts en texte, formulaire, critères de départage réordonnables, aperçu et vérification du chaînage, déroulement, groupes), `matches/` (section des matchs d'une étape, vues par format, carte de match, tableau graphique, formulaires de match et de résultats, statuts et résultats en texte), `common/` (confirmations de suppression et d'action, écran d'import/export partagé avec confirmation facultative) |
| `src/lib/api/` | Client HTTP (`client.ts`), appels d'authentification (`auth.ts`), lecture des erreurs serveur |
| `src/lib/auth/` | `AuthProvider`, `useAuth` (rôle, `isAdmin`), stockage observable des tokens (`token-store.ts`), renouvellement de session (`session.ts`), lecture des claims JWT (`jwt.ts`) |
| `src/features/games/` | Types, appels API, validation, import/export de fichiers, messages d'erreur |
| `src/features/stats/` | Types, appels API (définitions et associations jeu/statistique), validation, messages d'erreur |
| `src/features/teams/` | Types, appels API (équipes globales, membres, équipes de tournoi, import/export), validation, messages d'erreur, libellés de rôles |
| `src/features/tournaments/` | Types, appels API (tournois, statut, barème, inscriptions, classements, import/export), validation et conversion des dates, règles du cycle de vie et des droits d'interface, messages d'erreur, libellés |
| `src/features/steps/` | Types, appels API (étapes, classement par groupe, lancement, clôture), validation alignée sur le serveur, règles de chaînage et de cycle de vie, messages d'erreur, libellés |
| `src/features/matches/` | Types, appels API (matchs, résultats, statut), validation alignée sur le serveur (formulaire, résultats, droits et transitions), organisation pour l'affichage (groupes, tours, tableaux, disposition du tableau graphique), messages d'erreur, libellés |
| `src/features/users/` | Lecture des comptes (`GET /users`, `GET /user/{id}`) pour afficher les noms et proposer des membres |
| `src/i18n/` | Traductions FR/EN (`fr.ts`, `en.ts`), `I18nProvider`, `LanguageSwitcher` |
| `src/lib/validation/` | Règles de validation alignées sur le backend |

Routes : `/login`, `/register`, `/app` (protégée, redirige vers `/login`), `/games`, `/games/:id` (tous les rôles), `/games/new`, `/games/:id/edit`, `/games/transfer` (administrateurs), `/stats` (tous les rôles), `/stats/new`, `/stats/:id/edit`, `/stats/transfer` (administrateurs), `/teams`, `/teams/new`, `/teams/:id`, `/teams/:id/edit` (tout compte connecté ; modification réservée au propriétaire), `/teams/transfer` (administrateurs), `/tournaments`, `/tournaments/:id` (tout compte connecté), `/tournaments/new`, `/tournaments/:id/edit`, `/tournaments/transfer` (administrateurs), `/tournaments/:tournamentId/steps/:stepId`, `/tournaments/:tournamentId/steps/:stepId/bracket`, `/tournaments/:tournamentId/steps/:stepId/matches/:matchId` (tout compte connecté), `/tournaments/:tournamentId/steps/new`, `/tournaments/:tournamentId/steps/:stepId/edit`, `/tournaments/:tournamentId/steps/:stepId/matches/new`, `/tournaments/:tournamentId/steps/:stepId/matches/:matchId/edit` (administrateurs), `/tournaments/:tournamentId/teams`, `/tournaments/:tournamentId/teams/new`, `/tournaments/:tournamentId/teams/copy`, `/tournament-teams/:id`, `/tournament-teams/:id/edit`.

`/app` est la page principale, atteinte après connexion : en-tête avec navigation principale, nom du compte et déconnexion, puis un tableau de bord en quatre blocs (tournois en direct, mes pronostics, classement général, mes groupes). Les blocs affichent « Bientôt disponible » tant que les API correspondantes n'existent pas ; pour en brancher un, passer le contenu réel en `children` de `DashboardSection` (`src/components/home/`). Pour ajouter une entrée de navigation, compléter `NAV_ITEMS` dans `src/components/layout/AppHeader.tsx`.

## Authentification

Contrat de l'API publique (voir `backend/crates/api-public`) :

| Appel | Succès | Erreurs gérées |
|---|---|---|
| `POST /register` | 201 jetons (corps ignoré par le web) | 400 (`errors` par champ), 409 (nom déjà pris) |
| `POST /login` | 200 `{ access_token, refresh_token, token_type, expires_in }` | 400, 401 |
| `POST /logout` (Bearer JWT + `{ refresh_token }`) | 204 (révoque le refresh token) | ignorées : la session locale est fermée quoi qu'il arrive |

- `register` n'accepte que le **201** : un autre 2xx (proxy mal ciblé, squelette) est traité comme une erreur inattendue plutôt qu'un faux « Compte créé ».
- Après connexion, `GuestRoute` envoie vers la page visée avant la connexion, sinon vers `/app` ; un utilisateur déjà connecté qui ouvre `/login` ou `/register` est renvoyé vers `/app`.
- Seul mécanisme d'authentification : `Authorization: Bearer <JWT>`. Jamais d'en-tête `X-User-Id`.
- Les tokens restent **en mémoire** (pas de `localStorage`, exposé au XSS) : la session est perdue au rechargement de la page.
- **Renouvellement automatique** (`apiRequest`) : sur 401, `POST /refresh` (Bearer expiré toléré + `{ refresh_token }`, à usage unique) est appelé **une seule fois à la fois**, puis la requête est rejouée une fois. Si le serveur refuse le refresh token, ou si le rejeu est encore en 401, la session locale est fermée et l'utilisateur revient à `/login`. Une panne réseau pendant le renouvellement laisse la session intacte.
- **Rôle** : lu dans les claims du JWT (`role` : `user`, `admin`, `watcher`) pour adapter l'interface uniquement, sans vérifier la signature. Le serveur reste l'autorité (il relit le rôle en base et répond 403). Sur un 403 inattendu, la session est renouvelée pour relire le rôle ; l'écran d'administration disparaît si le rôle n'est plus `admin`.

## Jeux

Contrat : `GET /games?limit=&offset=` (ordre alphabétique du serveur), `GET /games/{id}`, `POST /games` (201), `PATCH /games/{id}` (champs modifiés uniquement), `DELETE /games/{id}` (204), `GET /games/export?format=json|csv`, `POST /games/import?format=json|csv` (corps brut, 256 Kio max). Tous les rôles consultent ; seuls les administrateurs créent, modifient, suppriment, importent et exportent (contrôles masqués aux autres, accès direct aux URL d'administration refusé, 401/403/404/409 traités).

- **Pagination** : taille de page 12 ; le front demande une entrée de plus (`limit=13`) pour savoir s'il existe une page suivante (l'API ne renvoie pas de total). La page est dans l'URL (`?page=`).
- **Validation** (`features/games/validation.ts`), identique au serveur : nom 1–64 caractères après trim, description ≤ 2000 caractères, ≤ 10 images, URL `http(s)` sans espace ≤ 2048 octets UTF-8. Un nom déjà pris (409 `game_name_taken`, insensible à la casse) est affiché sur le champ.
- **Export** : le fichier du serveur est téléchargé tel quel (`Content-Disposition` pour le nom, repli `games.<format>`).
- **Import** : contrôles locaux (extension `.json`/`.csv`, 1 octet–256 Kio, UTF-8, JSON syntaxiquement valide) puis envoi du corps brut ; le résultat `{ created, updated }` et `errors.file` du serveur sont affichés.
- **Statistiques des jeux** : l'export et l'import de jeux transportent la liste `stats` (`name`, `key`, `type`) de chaque jeu ; importer un jeu remplace les statistiques qui lui sont liées (voir la section suivante).
- Les types de `/games` sont écrits à la main : l'OpenAPI du dépôt ne décrit pas encore cette ressource.

## Statistiques

Définitions de statistiques (`flat` ou `percent`) et leurs associations aux jeux. Contrat : `GET /stats?limit=&offset=` (alphabétique), `GET /stats/{id}`, `POST /stats` (201), `PATCH /stats/{id}` (champs modifiés uniquement), `DELETE /stats/{id}` (204 ; **409 `stat_in_use`** si un tournoi en cours s'en sert), `GET /games/{id}/stats`, `PUT /games/{id}/stats/{stat_id}` (204, sans effet si déjà liée), `DELETE /games/{id}/stats/{stat_id}` (204, 404 si la liaison n'existe pas), `GET /stats/export?format=json|csv`, `POST /stats/import?format=json|csv` (corps brut, 256 Kio max). Tous les rôles consultent ; seuls les administrateurs créent, modifient, suppriment, associent, importent et exportent.

- **Catalogue** (`/stats`) : même pagination que les jeux (taille 12, `limit=13`, `?page=`), lecture seule pour `user` et `watcher`.
- **Fiche d'un jeu** : section « Statistiques du jeu » (`GameStatsSection`). Un administrateur associe une statistique existante (liste des statistiques pas encore liées) ou la retire ; la liste est relue après chaque modification, et un 404 sur une liaison déjà supprimée relit aussi la liste.
- **Validation** (`features/stats/validation.ts`), identique au serveur : nom 1–64 caractères après trim ; clé de 64 caractères maximum au format `^[a-z0-9]+(_[a-z0-9]+)*$` (unicité contrôlée par le serveur : **409 `stat_key_taken`** affiché sur le champ) ; type `flat` ou `percent`.
- **Import / export** : écran partagé avec les jeux (`components/common/TransferView.tsx`), fichiers `stats.json` / `stats.csv`. JSON `{ "version": 1, "stats": [{ "name", "key", "type", "games": [] }] }`, CSV `name,key,type,games`. Importer une statistique dont la clé existe la met à jour et **remplace** ses jeux liés ; un fichier invalide renvoie `errors.file`, affiché tel quel.
- Hors périmètre : saisie de valeurs de statistiques par match. Les types de `/stats` sont écrits à la main (l'OpenAPI du dépôt ne les décrit pas encore).

## Équipes

Équipes globales (liées à un jeu) et équipes de tournoi, séparées dans le code (`features/teams/api.ts` en deux blocs), les routes (`/teams/*` et `/tournaments/:id/teams`, `/tournament-teams/*`) et les libellés (`teams.*`, `tournamentTeams.*`). Contrat (PR #84) :

| Ressource | Appels |
|---|---|
| Équipes globales | `GET /teams?game_id=&limit=&offset=` (alphabétique), `GET /teams/{id}`, `POST /teams` (201), `PATCH /teams/{id}` (champs modifiés ; `""` efface le tag ou la photo), `DELETE /teams/{id}` (204) |
| Membres | `GET /teams/{id}/members` (actifs et anciens, `left_at`), `POST /teams/{id}/members` (201, `{ user_id, role }`), `PATCH /teams/{id}/members/{user_id}` (`{ role }`), `DELETE /teams/{id}/members/{user_id}` (204) |
| Équipes de tournoi | `GET /tournaments/{tournament_id}/teams?limit=&offset=`, `POST /tournaments/{tournament_id}/teams` (de zéro, ou `{ team_id, member_ids }`), `GET`/`PATCH`/`DELETE /tournament-teams/{id}`, mêmes routes de membres sous `/tournament-teams/{id}/members` |
| Comptes | `GET /users` (comptes proposés à l'ajout), `GET /user/{id}` (noms affichés) |
| Fichiers | `GET /teams/export?format=json\|csv`, `POST /teams/import?format=json\|csv` (corps brut, 256 Kio max) |

- **Droits** : tout compte connecté consulte et crée une équipe (il en devient propriétaire et premier membre). Seul le propriétaire (claim `sub` du JWT = `owner_id`) voit les contrôles de modification, suppression et gestion des membres ; un administrateur n'a aucun droit particulier sur une équipe qui n'est pas la sienne. Le serveur reste l'autorité (403). L'import/export est réservé aux administrateurs.
- **Liste** : filtre par jeu (`?game=`) et pagination (`?page=`, taille 12, `limit=13`) dans l'URL ; nom, tag, photo (tuile de repli si absente ou cassée), jeu et propriétaire.
- **Membres** : le propriétaire ajoute un compte existant comme `member` ou `substitute`, change le rôle d'un membre ou le retire après confirmation. Le propriétaire n'est jamais modifiable et le rôle `owner` n'est jamais proposé. La liste est relue après chaque opération (succès ou échec). Les anciens membres (équipes globales uniquement) sont affichés à part, avec leur période.
- **Équipes de tournoi** : l'UUID du tournoi vient de l'URL (aucun tournoi fictif ; la fiche d'un tournoi y mène, et les pages d'équipes de tournoi renvoient à la fiche du tournoi). Création de zéro, ou copie d'une équipe globale possédée avec choix des membres actifs (`member_ids`, propriétaire toujours copié). La copie reste indépendante de l'équipe globale.
- **Validation** (`features/teams/validation.ts`), identique au serveur : nom 1–64 caractères après trim (unique par jeu sans tenir compte de la casse : **409 `team_name_taken`** affiché sur le champ), tag facultatif 1–8 caractères, photo facultative en URL `http(s)` ≤ 2048 octets, identifiants UUID (un identifiant invalide ne déclenche aucune requête).
- **Erreurs** : 400 (détail par champ), 401 (retour à la connexion), 403, 404, 409 `already_team_member`, `team_already_registered`, `player_already_registered` ont chacun leur message.
- **Import / export** : écran partagé (`TransferView`), fichiers `teams.json` / `teams.csv`. JSON `{ "version": 1, "teams": [{ "game", "name", "tag", "picture_url", "owner", "members": [{ "username", "role", "joined_at", "left_at" }] }] }`, CSV `game,name,tag,picture_url,owner,members` (membres en JSON). Importer une équipe existante (même jeu et nom) **remplace** ses membres ; l'historique est conservé. Les équipes de tournoi ne sont pas exportées.

## Tournois

Catalogue, fiche, administration, inscriptions, barème et classements des tournois (`features/tournaments/`, `components/tournaments/`, libellés `tournaments.*`). Contrat (PR #88, `api-public/tournaments.rs`, `tournament_io.rs`) :

| Ressource | Appels |
|---|---|
| Tournois | `GET /tournaments?game_id=&status=&limit=&offset=` (par date de début), `GET /tournaments/{id}`, `POST /tournaments` (201, créé en `draft`), `PATCH /tournaments/{id}` (champs modifiés ; `null` efface une valeur facultative), `DELETE /tournaments/{id}` (204) |
| Statut | `POST /tournaments/{id}/status` (`{ status }`) |
| Barème | `GET`/`POST /tournaments/{id}/scoring-rules`, `PATCH`/`DELETE /tournaments/{id}/scoring-rules/{rule_id}` |
| Inscrits | `GET /tournaments/{id}/participants?limit=&offset=`, `POST /tournaments/{id}/participants` (`{ user_id?, tournament_team_id? }`), `PATCH`/`DELETE /tournaments/{id}/participants/{participant_id}`, `POST …/check-in` |
| Classements | `GET /tournaments/{id}/ranking`, `GET /tournaments/{id}/team-ranking` |
| Fichiers | `GET /tournaments/export?format=json\|csv`, `POST /tournaments/import?format=json\|csv` (corps brut, 256 Kio max) |

- **Catalogue** : filtres par jeu (liste filtrable) et par statut, page dans l'URL (`?game=`, `?status=`, `?page=`, taille 12, `limit=13`). Chaque carte affiche nom, statut **en texte** (jamais par la couleur seule), jeu, dates, type de participants et capacité.
- **Fiche** : jeu, description, dates, fenêtre d'inscription, type, taille d'équipe, capacité, score d'équipe ; lien vers les équipes du tournoi (`/tournaments/{id}/teams`, vrai UUID). Puis inscrits, étapes (voir [Étapes](#étapes)), barème et classements.
- **Administration** (rôle `admin`, `AdminRoute` ; le serveur reste juge) : création, modification, suppression après confirmation (masquée pour un tournoi `ongoing`). Le type de participants et le jeu sont fixés à la création ; `team_size` est obligatoire en équipe, `team_scoring_n` avec `top_n`. Pour un tournoi `ongoing` ou `finished`, la capacité, la taille d'équipe et le score d'équipe sont désactivés et jamais envoyés (409 `tournament_locked`).
- **Cycle de vie** : `draft → registration → ongoing → finished`, `cancelled` depuis `draft`, `registration` ou `ongoing`. Seules les transitions valides sont proposées, chacune après confirmation ; un 400 au démarrage affiche le détail du serveur (`errors.status` : trop peu d'inscrits, équipes incomplètes), un 409 la transition impossible.
- **Inscriptions** : formulaire affiché seulement au statut `registration` et dans la fenêtre d'inscription. Solo : le joueur s'inscrit, éventuellement pour une équipe du tournoi dont il est membre ; un administrateur peut choisir un autre compte (`GET /users`). Par équipes : le propriétaire inscrit une de ses équipes du tournoi (toutes pour un administrateur). Pointage (`registration`, inscrit `registered`), retrait (suppression avant le début, statut `withdrawn` pendant le tournoi) pour l'inscrit ou le propriétaire de l'équipe ; tout changement de statut (disqualification…) pour un administrateur, après confirmation. 409 `registration_closed`, `already_registered`, `tournament_full`, `player_already_registered` ont chacun leur message.
- **Barème** : une règle par statistique, `linear` (coefficient) ou `table` (valeur → points). Seules les statistiques liées au jeu du tournoi (`GET /games/{id}/stats`) et sans règle sont proposées. Modifiable en `draft` et `registration` uniquement ; 400 (statistique non liée), 409 `scoring_rule_taken` et `tournament_locked` expliqués.
- **Classements** : affichés tels que renvoyés par le serveur (rang, points), jamais recalculés ; classement des joueurs en solo, classement des équipes en tournoi par équipes ou en solo avec un mode de score autre que `none`.
- **Dates** : saisies en heure locale (`datetime-local`), envoyées en UTC RFC 3339 ; la fin ne précède pas le début, ni la clôture des inscriptions leur ouverture.
- **Import / export** : écran partagé (`TransferView`), fichiers `tournaments.json` / `tournaments.csv`. Avertissement permanent et **confirmation explicite** avant l'envoi : un tournoi existant (même jeu et nom) est mis à jour et son barème, ses inscrits, ses équipes, ses étapes et ses matchs sont **remplacés** (tous les matchs des étapes importées, `steps[].matches`) ; un tournoi `ongoing` ou `finished` est refusé (`errors.file` affiché tel quel). L'avertissement rappelle aussi que le serveur met les exports en cache une heure.
- Hors périmètre : génération des matchs et calcul des scores côté client (voir [Matchs](#matchs)).

## Étapes

Étapes d'un tournoi (`features/steps/`, `components/steps/`, libellés `steps.*`). Contrat (PR #92, `api-public/steps.rs`) :

| Ressource | Appels |
|---|---|
| Étapes | `GET /tournaments/{id}/steps` (par position), `GET /tournaments/{id}/steps/{step_id}`, `POST /tournaments/{id}/steps` (201, créée en `pending`), `PATCH /tournaments/{id}/steps/{step_id}` (champs modifiés), `DELETE /tournaments/{id}/steps/{step_id}` (204) |
| Groupes | `GET /tournaments/{id}/steps/{step_id}/ranking` (groupes, participants, points, rang, statut) |
| Déroulement | `POST /tournaments/{id}/steps/{step_id}/start`, `POST /tournaments/{id}/steps/{step_id}/close` (`{ step, next_step }`) |

- **Fiche du tournoi** : section « Étapes » avec les étapes dans leur ordre (position, format, type de match, statut **en texte**, groupes, participants accueillis → qualifiés) et un lien vers chaque étape. Tant que le tournoi est en `draft` ou `registration`, la vérification du chaînage est affichée (mêmes règles que le serveur) ; les administrateurs y ajoutent et modifient les étapes.
- **Page d'une étape** (`/tournaments/{id}/steps/{step_id}`) : réglages (format, type de match, groupes, manches, qualifiés, critères de départage par priorité), déroulement, groupes et classements, puis matchs (voir [Matchs](#matchs)).
- **Administration** (rôle `admin`, `AdminRoute` ; le serveur reste juge) : création, modification (seuls les champs modifiés sont envoyés) et suppression après confirmation. Champs : `position`, `format` (`pool`, `swiss`, `single_elim`, `double_elim`), `match_type` (`duel`, `ffa`), `group_count`, `group_size`, `matches_per_group` (1 par défaut), `advance_per_group` et `tiebreak`. Validation alignée sur le serveur : position de 1 à 100 et unique ; 1 à 1000 groupes (un seul hors `pool`, champ alors forcé à 1) ; groupes de 2 à 10 000 participants, 10 000 au total ; 1 à 1000 manches ; 1 à `group_size` qualifiés ; 8 critères distincts au plus en `[a-z0-9_]{1,32}`, ajoutés, retirés et réordonnés au clavier (Monter / Descendre, changement annoncé, focus conservé).
- **Chaînage** : expliqué dans le formulaire avec un aperçu en direct (participants accueillis et qualifiés face à ce qu'attendent le tournoi et les étapes voisines) et vérifié par le serveur au démarrage du tournoi : positions de 1 à n, l'étape 1 accueille `max_participants` (`group_count × group_size`), l'étape n les qualifiés de l'étape n−1 (`group_count × advance_per_group`), la dernière qualifie un seul participant.
- **Verrouillage** : dès que le tournoi est `ongoing` (ou `finished`, `cancelled`), ajout, modification et suppression sont retirés et expliqués ; un 409 `tournament_locked` survenu entre-temps est expliqué, comme un 409 `step_position_taken` (affiché sur le champ position).
- **Déroulement** (administrateurs) : lancement d'une étape `pending` quand le tournoi est `ongoing` et les étapes précédentes `finished` (sinon le bouton est désactivé avec la raison) ; clôture d'une étape `ongoing`. Les deux demandent une confirmation explicite. Un 400 affiche le détail du serveur (`errors.steps` : chaînage invalide, `errors.participants` : trop ou trop peu de participants), un 409 la transition impossible. Après chaque opération, l'étape, les groupes, les qualifications et l'étape suivante (ouverte automatiquement ou restée en attente, avec un lien) sont relus. Le tournoi lui-même se termine par son propre cycle de vie.
- **Groupes et classements** : affichés exactement comme renvoyés par le serveur (index, rang, points, statut) ; aucun tirage, classement ni départage n'est refait côté client. Statuts `in` (« En lice »), `qualified` (« Qualifié »), `eliminated` (« Éliminé ») écrits en toutes lettres. Identité tirée des inscrits du tournoi : le joueur (et l'équipe pour laquelle il marque) en solo, l'équipe en tournoi par équipes.
- **Import / export** : pas d'appel dédié. Les étapes (avec groupes, participants et statuts) font partie de l'import / export des tournois, dont l'avertissement précise qu'elles sont remplacées.
- **Limites du backend** : le lancement d'une étape ne génère pas ses matchs (voir [Matchs](#matchs)) et les critères de départage sont stockés mais pas évalués : à égalité de points, l'ordre d'inscription départage à la clôture.

## Matchs

Matchs d'une étape (`features/matches/`, `components/matches/`, libellés `matches.*`). Contrat (PR #96, `api-public/matches.rs`) :

| Ressource | Appels |
|---|---|
| Matchs | `GET /tournaments/{id}/steps/{step_id}/matches?group_id=&status=` (par groupe puis par tour), `GET …/matches/{match_id}`, `POST …/matches` (201, créé en `scheduled`), `PATCH …/matches/{match_id}` (champs modifiés ; `null` efface), `DELETE …/matches/{match_id}` (204) |
| Résultats | `PUT …/matches/{match_id}/results` (`{ results: [{ participant_id, stats, rank?, result? }] }`) |
| Statut | `POST …/matches/{match_id}/status` (`ongoing`, `finished`, `cancelled` ; réponse avec `step_closed: { step, next_step }` quand l'étape se clôture) |

- **Limite du backend** : le serveur accepte les matchs créés à la main mais **ne génère rien** — ni manches de poule, ni appariements suisses, ni tableau d'élimination — au lancement d'une étape. L'interface l'écrit sur la page de l'étape et sur le tableau, et n'affiche que les matchs existants : aucun match, participant, appariement ni lien n'est inventé, et aucune propagation du vainqueur, élimination, score ou départage n'est calculé côté client.
- **Page d'une étape** : section « Matchs » avec filtres du serveur (groupe, statut), compte annoncé, états de chargement, vide, erreur et « Réessayer ». Vue propre au format : poules par groupe puis par manche, système suisse par ronde (classements de l'étape juste au-dessus), élimination par tableau (gagnants, perdants, grande finale) puis par tour. Chaque match montre son numéro (place dans la liste complète de l'étape), statut **en texte** (`scheduled` Programmé, `ongoing` En cours, `finished` Terminé, `cancelled` Annulé), tour, tableau, date, participants (joueurs ou équipes selon le tournoi) avec rang, points et résultat renvoyés par le serveur.
- **Tableau** (`/tournaments/{id}/steps/{step_id}/bracket`, lien depuis la page de l'étape et la liste des étapes du tournoi) : en simple et double élimination, colonnes par tour, bandes par tableau, liens tracés d'après `next_match_id`. Places libres : « Vainqueur du match N » pour un match précédent encore à jouer, « À déterminer » sinon ; un tableau incomplet (lien manquant, match vide) est montré tel quel. Zone défilable au clavier (focalisable), zoom (−, 100 %, +, ajuster à la largeur), chaque match est un lien vers son détail avec une description complète. Alternative accessible : la liste par tour, avec les mêmes informations et actions. Les autres formats affichent leur vue propre.
- **Détail d'un match** (`…/matches/{match_id}`) : groupe, tour, tableau, dates prévue / début / fin, matchs qui l'alimentent et match suivant, participants avec rang, points, résultat (`win` Victoire, `loss` Défaite, `draw` Égalité) et statistiques (détail par joueur d'une équipe si présent).
- **Administration** (rôle `admin`, `AdminRoute` ; les autres rôles sont en lecture seule) : création, modification et suppression (confirmation). Formulaire : groupe (parmi les groupes tirés de l'étape, fixe ensuite), participants choisis parmi les membres réels du groupe, tour (1 à 1000), tableau (double élimination seulement), match suivant (élimination seulement, autre match de l'étape, sans boucle), date prévue. Un duel compte 2 participants au plus, une mêlée générale `group_size` ; un match d'élimination peut être créé vide.
- **Cycle de vie** : `scheduled → ongoing → finished`, `scheduled → finished`, `cancelled` tant que le match n'est pas terminé. Lancer et terminer exigent 2 participants en duel, de 2 à `group_size` en mêlée (boutons désactivés avec la raison) ; terminer et annuler demandent une confirmation explicite, comme la suppression. Écritures possibles seulement pendant l'étape (`ongoing`) ; un match terminé ne se modifie ni ne se supprime ; les participants ne changent que tant que le match est `scheduled`.
- **Résultats** : saisie avec les statistiques liées au jeu du tournoi (barème signalé), validées avant l'envoi comme par le serveur (nombres finis de ±1 milliard, pourcentages de 0 à 100, rang de 1 au nombre de participants) puis par le serveur (400 affiché tel quel). Rang et résultat facultatifs : sans rang, le serveur les déduit des points ; sans résultat, la première place gagne (égalité si partagée). Le détail par joueur d'une équipe déjà enregistré est conservé. Points, rangs et vainqueurs viennent uniquement des réponses du serveur.
- **Progression** : à la fin d'un match, le serveur place le vainqueur dans le match suivant. Quand la réponse contient `step_closed`, la clôture automatique est annoncée avec des liens vers les classements de l'étape et l'étape suivante ; l'interface ne redemande jamais la clôture. Les pages se relisent en y revenant (match, groupes et classements, classements du tournoi, étape suivante).
- **Erreurs et concurrence** : 400, 401, 403, 404 et 409 ont chacun leur message ; contrôles désactivés pendant chaque requête ; un 409 recharge les données pour montrer l'état réel.
- **Import / export** : pas d'appel dédié. Les matchs (participants et statistiques) voyagent dans le tableau `matches` de leur étape, dans le fichier des tournois (`GET /tournaments/export`, `POST /tournaments/import`). L'avertissement de l'écran d'import précise que tous les matchs des étapes importées sont remplacés et que les exports sont mis en cache une heure.

## Langues

Les écrans de jeux, de statistiques, d'équipes, de tournois, l'en-tête et le sélecteur de langue sont disponibles en **français** (défaut) et en **anglais** (`src/i18n/`, choix mémorisé dans `localStorage` sous `epickem-lang`, attribut `lang` du document mis à jour). Les écrans de connexion, d'inscription et d'accueil restent en français pour l'instant. Toute nouvelle clé doit exister dans `fr.ts` et `en.ts` (le type `Messages` le vérifie).

## API

Le navigateur appelle `/api/*`, proxifié vers `api-public` en retirant le préfixe `/api` :

- en dev, par Vite (`VITE_DEV_API_TARGET`, défaut `http://localhost:8080`) ;
- en Docker, par nginx (`API_UPSTREAM`, défaut `api-public:8080`).

Variables : voir [`.env.example`](.env.example) (`.env.local` pour surcharger).

## Accessibilité

Formulaires : libellés reliés, aide et erreurs liées aux champs (`aria-describedby`, `aria-invalid`), résumé d'erreurs annoncé (`role="alert"`) qui reçoit le focus, `autocomplete` adaptés, titre de page par écran, lien d'évitement, focus ramené sur le contenu à chaque navigation. Listes filtrables (`components/ui/searchable-select.tsx`) au motif « combobox » WAI-ARIA 1.2 : saisie pour filtrer, flèches, Entrée, Échap. Actions irréversibles toujours confirmées dans une boîte de dialogue (focus piégé, Échap annule). Cible : WCAG 2.2 AA.

## Ajouter un composant shadcn/ui

```sh
npx shadcn@latest add <composant>   # ex. dialog, card, table
```

La configuration est dans [`components.json`](components.json) ; alias `@/` → `src/`.

## Docker

```sh
docker build -t epickem-web web/
docker run --rm -p 3000:8080 epickem-web   # http://localhost:3000
```

Image en deux étapes (build Node, puis nginx non-root sur le port 8080 avec fallback SPA et `/healthz`). Via Compose : `make up` expose le front sur `WEB_PORT` (3000 par défaut).

## CI

[`.github/workflows/web.yml`](../.github/workflows/web.yml) exécute `npm ci`, `npm run lint`, `npm test` et `npm run build` à chaque PR touchant `web/`.

## Apparence

Configuration shadcn : `npx shadcn@latest init --preset b5vnF8h2A --base radix --template vite`. Les composants existants utilisent ce preset.
Le logo partagé est servi depuis `public/brand/epickem-logo.svg`. Le bouton de l’en-tête permet de basculer entre les thèmes clair et sombre ; le mode sombre est actif par défaut et le choix est mémorisé localement.
