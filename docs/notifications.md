# Réglages utilisateur et moteur de notifications

Ce document décrit les réglages persistants d'un compte, le moteur de notifications de
`api-public` (e-mail via Resend, push via Expo), le catalogue des événements et la marche à suivre
pour en ajouter.

## Réglages (`user_settings`)

Un compte a au plus une ligne `user_settings` (relation 1-1 avec `users`, supprimée avec lui) :

| Champ | Valeurs | Défaut |
|---|---|---|
| `language` | `fr`, `en`, `es` | `fr` |
| `theme` | `system`, `light`, `dark` | `system` |
| `notifications` | par catégorie, `{ email, push }` | tout activé |

Catégories : `tournaments`, `teams`, `matches`, `predictions`, `pickem`, `rankings`, `account`.
En base, les préférences sont des surcharges à clés plates `<catégorie>_<canal>` (`teams_email`) :
une clé absente vaut « activé », et un `PATCH` ne remplace que les clés envoyées (fusion JSONB
atomique, sans lecture préalable). La migration `0016` crée une ligne par compte existant ; les
comptes créés ensuite n'en ont pas tant qu'ils n'ont rien modifié, et la lecture renvoie les défauts.

| Route | Effet |
|---|---|
| `GET /me/settings` | réglages complets du compte du jeton |
| `PATCH /me/settings` | mise à jour partielle (`language?`, `theme?`, `notifications?`) ; au moins un champ, champs inconnus refusés |
| `POST /me/push-tokens` | `{ token, platform: ios\|android }` → `201 { id, platform }` |
| `DELETE /me/push-tokens` | `{ token }` → `204`, ou `404` si le jeton n'est pas celui d'un appareil du compte |

Aucune de ces routes ne prend d'identifiant de compte : elles agissent sur le compte du jeton
d'accès, et les réglages n'apparaissent dans aucune vue publique (`UserProfile` n'expose que
`picture_url`).

### Photo de profil

`users.picture_url` (2048 caractères au plus) suit la convention des équipes : URL `http(s)` sans
espace, validée par `is_image_url` ; `PATCH /me/update` et `PATCH /user/{id}/update` acceptent
`picture_url`, et une chaîne vide l'efface. Elle est renvoyée par `/me`, `/users` et `/user/{id}`.

### Appareils push

`push_tokens` stocke un jeton Expo (`ExponentPushToken[...]`, format validé) par appareil. Le jeton
est unique : l'enregistrer depuis un autre compte le déplace (l'appareil a changé de compte). Un
compte garde 10 appareils au plus (les plus anciens sont retirés). Les jetons ne sont jamais
renvoyés par l'API ; ceux que le service de push déclare inconnus (`DeviceNotRegistered`) sont
supprimés au premier envoi.

## Moteur de notifications

Module `notifications`. Un handler, une fois son opération réussie, appelle
`notifications::emit(&state, event)` :

1. `emit` rend la main aussitôt ; la livraison se déroule dans une tâche à part. Une erreur de
   livraison est journalisée et n'annule jamais l'opération métier.
2. Les destinataires sont résolus (`Audience`) : des comptes, les inscrits actifs d'un tournoi
   (joueurs, ou membres des équipes inscrites, hors `withdrawn` et `disqualified`) ou des
   inscriptions précises.
3. Pour chaque destinataire et chaque canal de l'événement, le moteur lit les réglages, ignore le
   canal si la catégorie y est désactivée, puis réserve la livraison `(clé, compte, canal)` dans
   `notification_log` : un événement émis deux fois ne prévient qu'une fois.
4. Il rédige titre et corps dans la langue du compte à partir des textes `fr`/`en`/`es` du
   catalogue, puis envoie.
5. Un envoi est tenté 3 fois (attente 0,5 s puis 1 s). En cas d'échec définitif, la réservation est
   levée : ré-émettre l'événement relivre. Un jeton refusé (`DeviceNotRegistered`) est supprimé sans
   nouvel essai ; un refus définitif n'est pas repris.

Conditions par canal : l'e-mail exige un `Mailer` configuré et une adresse **vérifiée** ; le push
exige `PUSH_ENABLED=true` et au moins un appareil enregistré.

### E-mails de sécurité

La vérification d'adresse, le mot de passe oublié et l'e-mail de bienvenue ne passent **pas** par le
moteur : ils ignorent les préférences et ne peuvent pas être désactivés.

### Catalogue des événements

| `kind` | Catégorie | Destinataires | Déclencheur | Clé de dédoublonnage |
|---|---|---|---|---|
| `tournament.started` | tournaments | inscrits actifs | `POST /tournaments/{id}/status` → `ongoing` | `kind:<tournoi>` |
| `tournament.finished` | tournaments | inscrits actifs | statut → `finished` | `kind:<tournoi>` |
| `tournament.cancelled` | tournaments | inscrits actifs | statut → `cancelled` | `kind:<tournoi>` |
| `tournament.disqualified` | tournaments | l'inscrit (ou son équipe) | `PATCH .../participants/{id}` → `disqualified` | `kind:<inscription>` |
| `team.member_added` | teams | le membre ajouté | `POST /teams/{id}/members`, `POST /tournament-teams/{id}/members` | `kind:<équipe>:<compte>:<horodatage>` |
| `team.member_removed` | teams | le membre retiré | `DELETE /teams/{id}/members/{user}`, `DELETE /tournament-teams/{id}/members/{user}` | idem |
| `match.started` | matches | participants du match | statut du match → `ongoing` | `kind:<match>` |
| `match.finished` | matches | participants du match | statut du match → `finished` | `kind:<match>` |

Les catégories `predictions`, `pickem`, `rankings` et `account` n'ont pas encore d'événement : elles
sont réservées aux futures fonctions et déjà réglables.

Variables des textes : `tournament_id`, `tournament_name` (tournois, matchs), `team_id`,
`team_name` (équipes), `step_id`, `match_id` (matchs).

### Ajouter un événement (contrat d'extension)

Le cœur du moteur n'a pas à changer :

1. Décrire l'événement avec une `EventDefinition` : `kind` (`domaine.action`, stable), `category`,
   `channels`, `texts` (titre et corps en `fr`, `en`, `es`, avec des `{variables}`) et `path`
   (page ouverte, facultative).
2. Le déclarer : soit dans `BUILTIN` (`notifications.rs`), soit à l'assemblage de l'application
   avec `let mut catalog = Catalog::builtin(); catalog.register(definition);` puis
   `AppState::with_catalog(catalog)`. `register` refuse un `kind` déjà pris.
3. Après l'opération métier réussie, émettre : `notifications::emit(&state, Event { kind, key,
   audience, payload })`. `key` doit être identique pour deux émissions du même fait (ex.
   `match.finished:<id>`) et distincte entre deux faits distincts ; `payload` est un objet JSON dont
   les valeurs texte ou numériques remplissent les `{variables}` et sont transmises au push.
4. Ajouter les tests : texte non vide dans les trois langues (le test du catalogue le vérifie pour
   les événements intégrés) et livraison via l'API.

Ne jamais appeler `emit` avant que l'opération ne soit validée, ni attendre sa livraison dans la
requête.

## Resend : modèles et variables

Un modèle publié par langue (alias configurables, voir `.env.example`) :

| Variable d'environnement | Défaut |
|---|---|
| `RESEND_NOTIFICATION_TEMPLATE_FR` | `notification-fr` |
| `RESEND_NOTIFICATION_TEMPLATE_EN` | `notification-en` |
| `RESEND_NOTIFICATION_TEMPLATE_ES` | `notification-es` |

Chaque envoi passe l'objet `subject` (= titre) et ces variables, à déclarer dans les trois modèles :

| Variable | Type | Contenu |
|---|---|---|
| `TITLE` | chaîne | titre localisé |
| `BODY` | chaîne | corps localisé |
| `CATEGORY` | chaîne | catégorie (`tournaments`, `teams`, …) |
| `LANGUAGE` | chaîne | `fr`, `en` ou `es` |
| `ACTION_URL` | chaîne | lien absolu (`PUBLIC_URL` + page), vide s'il n'y en a pas |
| `HAS_ACTION` | booléen | `true` si `ACTION_URL` est renseigné |

Les modèles de sécurité existants (`password-reset`, `email-address-confirmation`,
`welcome-account`) sont inchangés.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PUSH_ENABLED` | `false` | active l'envoi push via Expo ; sinon le canal push est ignoré |
| `EXPO_ACCESS_TOKEN` | — | jeton d'accès Expo (facultatif) |
