# ADR-011 — Connexion Google (OpenID Connect) et double authentification TOTP

- **Statut :** Proposé
- **Date :** 2026-11-11
- **Décideurs :** équipe backend
- **Issue liée :** #169, #170

## Contexte

Les utilisateurs veulent se connecter avec leur compte Google et protéger leur compte par un
second facteur. L'authentification existante (ADR-009) reste la référence : JWT d'accès court,
jeton de rafraîchissement opaque à usage unique, mots de passe Argon2id, réinitialisation par
e-mail.

Contraintes :

- un compte existant ne doit jamais pouvoir être pris en main par quelqu'un qui contrôle
  seulement une adresse e-mail identique chez Google ;
- aucun jeton de session ne doit être émis avant le second facteur ;
- une fuite de la base ne doit donner ni secret TOTP ni code de récupération utilisables.

## Options étudiées

### Flux OAuth
- **A — Flux implicite / jeton d'identité reçu par le front** : ❌ le jeton transite par le
  navigateur, pas de PKCE, déconseillé par OAuth 2.1.
- **B — Code d'autorisation + PKCE, échange et validation côté serveur** : ✅ le secret client
  et la validation restent sur le serveur ; `state`, `nonce` et vérificateur PKCE générés et
  gardés par le serveur.

### Identification du compte Google
- **A — Par adresse e-mail** : ❌ fusion automatique, détournement de compte possible.
- **B — Par le claim `sub` (stable), table `oauth_accounts`** : ✅ liaison explicite seulement.

### Second facteur
- **A — Code par e-mail** : ❌ même canal que la réinitialisation du mot de passe.
- **B — TOTP (RFC 6238) + codes de récupération** : ✅ standard, hors ligne, sans fournisseur.

## Décision

**Code d'autorisation + PKCE, identité par `sub`, TOTP chiffré.**

- **Google :** `POST /auth/google/authorize` crée `state`, `nonce` et vérificateur PKCE (256 bits
  chacun) ; seule l'empreinte du `state` est la clé en base (`oauth_states`, 10 minutes, usage
  unique par `DELETE … RETURNING`). Le callback échange le code (avec le vérificateur) et valide
  le jeton d'identité : RS256 avec les clés JWKS de Google (cache d'une heure, rechargé sur `kid`
  inconnu), `iss`, `aud` = `GOOGLE_CLIENT_ID`, `exp`, `nonce`. Seules les URL fixes de Google sont
  appelées (pas de SSRF).
- **Création de compte :** identité inconnue → compte avec l'adresse **vérifiée** par Google
  (`email_verified_at` renseigné), nom d'utilisateur unique déduit de l'adresse, mot de passe
  aléatoire de 256 bits haché en Argon2id (jamais renvoyé, journalisé ni stocké en clair),
  `users.password_set = false`. `/forgot-password` permet ensuite d'en choisir un vrai.
  Adresse déjà utilisée → `409 account_exists` : l'utilisateur se connecte et lie Google lui-même.
- **Liaison / déliaison :** authentification de moins de 10 minutes (claim `auth_time`, conservé
  par `/refresh`) et second facteur s'il est actif. La déliaison est refusée si le compte n'a pas
  de mot de passe choisi (dernière méthode de connexion) et révoque les sessions.
- **TOTP :** secret de 160 bits chiffré en AES-256-GCM (`TOTP_ENCRYPTION_KEY`, nonce aléatoire,
  identifiant du compte en donnée associée) ; activé seulement après un premier code valide ;
  fenêtre de ±1 pas ; dernier pas utilisé mémorisé (rejeu refusé). Dix codes de récupération de
  60 bits, hachés SHA-256, consommés par un `UPDATE` conditionnel (usage unique, même en parallèle).
- **Connexion :** mot de passe ou Google, puis, si la double authentification est active, défi
  opaque de 5 minutes (`mfa_challenges`, 5 essais, consommé une fois) échangé contre les jetons
  par `POST /login/2fa`.
- **Limitation :** 30 demandes Google par IP et 10 codes par compte par quart d'heure
  (`auth_attempt_limits`).

## Conséquences

- **Positives :** aucune fusion de comptes implicite ; le second facteur s'applique à toutes les
  méthodes ; base volée sans secret TOTP ni code de récupération exploitable.
- **Négatives / coûts acceptés :** sans `TOTP_ENCRYPTION_KEY`, les comptes ayant activé la double
  authentification ne peuvent plus se connecter (la clé est donc un secret critique, ADR-007) ;
  changer la clé impose une rotation (déchiffrer/rechiffrer), non outillée pour l'instant ;
  derrière un proxy, la limite par IP vise l'adresse du proxy.
- **Actions à mener :** écrans web et mobile (#171, #172) ; outil de rotation de la clé TOTP.
