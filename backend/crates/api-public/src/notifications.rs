//! Moteur de notifications : événement métier → e-mail et/ou push, localisés et filtrés par les
//! préférences du destinataire. Voir `docs/notifications.md` pour le catalogue des événements et
//! le contrat d'extension.
//!
//! Principes :
//! - [`emit`] ne bloque jamais l'appelant et ne renvoie aucune erreur : la livraison se fait dans
//!   une tâche à part, après l'opération métier réussie ; un échec se journalise et ne défait rien ;
//! - une même livraison `(clé de l'événement, destinataire, canal)` n'a lieu qu'une fois
//!   (`notification_log`), un événement émis deux fois ne prévient donc pas deux fois ;
//! - les préférences (catégorie × canal) sont lues juste avant chaque livraison ;
//! - les e-mails de sécurité (vérification, mot de passe oublié) n'y passent pas : ils ne sont pas
//!   désactivables.

use crate::auth::AppState;
use crate::mail::{Mailer, NotificationMail};
use crate::push::{PushError, PushSender};
use crate::store::{
    AuthStore, Category, Channel, Language, ParticipantStatus, StoreError, Tournament,
    TournamentParticipant, TournamentStatus, UserSettings,
};
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

/// Nombre maximal d'essais d'une livraison (le premier compris).
pub const MAX_ATTEMPTS: u32 = 3;
/// Attente avant la reprise : `RETRY_DELAY × numéro de l'essai`.
pub const DEFAULT_RETRY_DELAY: Duration = Duration::from_millis(500);
const PAGE: i64 = 100;

/// Description d'un type d'événement. Les textes contiennent des `{variable}` remplacées par
/// les valeurs de la charge utile de l'événement.
#[derive(Debug, Clone)]
pub struct EventDefinition {
    /// Identifiant stable, `domaine.action` (ex. `match.finished`).
    pub kind: &'static str,
    pub category: Category,
    pub channels: &'static [Channel],
    /// `(titre, corps)` en français, anglais puis espagnol.
    pub texts: [(&'static str, &'static str); 3],
    /// Page ouverte au toucher, relative à l'origine du site (variables comprises).
    pub path: Option<&'static str>,
}

const BOTH: &[Channel] = &[Channel::Email, Channel::Push];

/// Catalogue des types d'événements connus du moteur.
#[derive(Debug, Clone)]
pub struct Catalog {
    events: HashMap<&'static str, EventDefinition>,
}

impl Default for Catalog {
    fn default() -> Self {
        Self::builtin()
    }
}

impl Catalog {
    pub fn empty() -> Self {
        Catalog {
            events: HashMap::new(),
        }
    }

    /// Les événements des tournois, équipes et matchs.
    pub fn builtin() -> Self {
        let mut catalog = Catalog::empty();
        for definition in BUILTIN {
            catalog.events.insert(definition.kind, definition.clone());
        }
        catalog
    }

    /// Ajoute un type d'événement ; `false` (rien n'est modifié) si l'identifiant existe déjà.
    pub fn register(&mut self, definition: EventDefinition) -> bool {
        if self.events.contains_key(definition.kind) {
            return false;
        }
        self.events.insert(definition.kind, definition);
        true
    }

    pub fn get(&self, kind: &str) -> Option<&EventDefinition> {
        self.events.get(kind)
    }

    pub fn kinds(&self) -> Vec<&'static str> {
        let mut kinds: Vec<_> = self.events.keys().copied().collect();
        kinds.sort_unstable();
        kinds
    }
}

const BUILTIN: &[EventDefinition] = &[
    EventDefinition {
        kind: "tournament.started",
        category: Category::Tournaments,
        channels: BOTH,
        texts: [
            (
                "Le tournoi {tournament_name} commence",
                "{tournament_name} vient de démarrer. Bonne chance !",
            ),
            (
                "{tournament_name} has started",
                "{tournament_name} has just started. Good luck!",
            ),
            (
                "{tournament_name} ha comenzado",
                "{tournament_name} acaba de comenzar. ¡Buena suerte!",
            ),
        ],
        path: Some("/tournaments/{tournament_id}"),
    },
    EventDefinition {
        kind: "tournament.finished",
        category: Category::Tournaments,
        channels: BOTH,
        texts: [
            (
                "Le tournoi {tournament_name} est terminé",
                "{tournament_name} est terminé. Consultez les résultats.",
            ),
            (
                "{tournament_name} is over",
                "{tournament_name} has finished. Check out the results.",
            ),
            (
                "{tournament_name} ha terminado",
                "{tournament_name} ha terminado. Consulta los resultados.",
            ),
        ],
        path: Some("/tournaments/{tournament_id}"),
    },
    EventDefinition {
        kind: "tournament.cancelled",
        category: Category::Tournaments,
        channels: BOTH,
        texts: [
            (
                "Le tournoi {tournament_name} est annulé",
                "{tournament_name} a été annulé par les organisateurs.",
            ),
            (
                "{tournament_name} was cancelled",
                "{tournament_name} was cancelled by the organizers.",
            ),
            (
                "{tournament_name} se ha cancelado",
                "{tournament_name} ha sido cancelado por los organizadores.",
            ),
        ],
        path: Some("/tournaments/{tournament_id}"),
    },
    EventDefinition {
        kind: "tournament.disqualified",
        category: Category::Tournaments,
        channels: BOTH,
        texts: [
            (
                "Disqualification de {tournament_name}",
                "Votre inscription à {tournament_name} a été disqualifiée.",
            ),
            (
                "Disqualified from {tournament_name}",
                "Your entry in {tournament_name} was disqualified.",
            ),
            (
                "Descalificación de {tournament_name}",
                "Tu inscripción en {tournament_name} ha sido descalificada.",
            ),
        ],
        path: Some("/tournaments/{tournament_id}"),
    },
    EventDefinition {
        kind: "team.member_added",
        category: Category::Teams,
        channels: BOTH,
        texts: [
            (
                "Bienvenue dans {team_name}",
                "Vous avez rejoint l'équipe {team_name}.",
            ),
            ("Welcome to {team_name}", "You joined the team {team_name}."),
            (
                "Bienvenido a {team_name}",
                "Te has unido al equipo {team_name}.",
            ),
        ],
        path: None,
    },
    EventDefinition {
        kind: "team.member_removed",
        category: Category::Teams,
        channels: BOTH,
        texts: [
            (
                "Vous avez quitté {team_name}",
                "Vous ne faites plus partie de l'équipe {team_name}.",
            ),
            (
                "You left {team_name}",
                "You are no longer part of the team {team_name}.",
            ),
            (
                "Has salido de {team_name}",
                "Ya no formas parte del equipo {team_name}.",
            ),
        ],
        path: None,
    },
    EventDefinition {
        kind: "match.started",
        category: Category::Matches,
        channels: BOTH,
        texts: [
            (
                "Votre match commence",
                "Un match de {tournament_name} vient de commencer.",
            ),
            (
                "Your match is starting",
                "A match of {tournament_name} has just started.",
            ),
            (
                "Tu partida comienza",
                "Una partida de {tournament_name} acaba de comenzar.",
            ),
        ],
        path: Some("/tournaments/{tournament_id}/steps/{step_id}"),
    },
    EventDefinition {
        kind: "match.finished",
        category: Category::Matches,
        channels: BOTH,
        texts: [
            (
                "Match terminé",
                "Les résultats de votre match de {tournament_name} sont disponibles.",
            ),
            (
                "Match finished",
                "The results of your {tournament_name} match are available.",
            ),
            (
                "Partida terminada",
                "Ya están disponibles los resultados de tu partida de {tournament_name}.",
            ),
        ],
        path: Some("/tournaments/{tournament_id}/steps/{step_id}"),
    },
];

/// À qui s'adresse un événement ; résolu au moment de la livraison, hors de la requête HTTP.
#[derive(Debug, Clone)]
pub enum Audience {
    /// Des comptes.
    Users(Vec<Uuid>),
    /// Les inscrits actifs d'un tournoi (ni retirés ni disqualifiés), joueurs ou membres des
    /// équipes inscrites.
    Tournament(Uuid),
    /// Des inscriptions précises à un tournoi (`tournament_participant.id`).
    Participants(Vec<Uuid>),
}

/// Événement à notifier.
#[derive(Debug, Clone)]
pub struct Event {
    pub kind: &'static str,
    /// Clé de dédoublonnage : deux événements de même clé ne préviennent qu'une fois.
    pub key: String,
    pub audience: Audience,
    /// Objet JSON dont les valeurs remplissent les `{variables}` des textes.
    pub payload: Value,
}

/// Remplace les `{variable}` ; une variable inconnue devient une chaîne vide.
pub fn render(template: &str, payload: &Value) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) => {
                match &payload[&after[..end]] {
                    Value::String(text) => out.push_str(text),
                    Value::Number(number) => out.push_str(&number.to_string()),
                    _ => {}
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Titre et corps d'un événement dans la langue donnée.
pub fn localized(
    definition: &EventDefinition,
    language: Language,
    payload: &Value,
) -> (String, String) {
    let (title, body) = definition.texts[match language {
        Language::Fr => 0,
        Language::En => 1,
        Language::Es => 2,
    }];
    (render(title, payload), render(body, payload))
}

/// Les dépendances de livraison, clonées depuis l'[`AppState`].
#[derive(Clone)]
pub struct Notifier {
    store: Arc<dyn AuthStore>,
    mailer: Arc<dyn Mailer>,
    push: Arc<dyn PushSender>,
    catalog: Arc<Catalog>,
    public_url: Arc<str>,
    retry_delay: Duration,
}

/// Confie l'événement au moteur ; rend la main tout de suite. À appeler une fois l'opération
/// métier réussie.
pub fn emit(state: &AppState, event: Event) {
    let notifier = Notifier::from_state(state);
    actix_web::rt::spawn(async move { notifier.deliver(event).await });
}

impl Notifier {
    pub fn from_state(state: &AppState) -> Self {
        Notifier {
            store: state.store.clone(),
            mailer: state.mailer.clone(),
            push: state.push.clone(),
            catalog: state.catalog.clone(),
            public_url: state.public_url.clone(),
            retry_delay: state.retry_delay,
        }
    }

    /// Livre l'événement à tous ses destinataires. N'échoue jamais : les erreurs se journalisent.
    pub async fn deliver(&self, event: Event) {
        let Some(definition) = self.catalog.get(event.kind) else {
            eprintln!(
                "api-public : événement de notification inconnu : {}",
                event.kind
            );
            return;
        };
        let recipients = match self.recipients(&event.audience).await {
            Ok(recipients) => recipients,
            Err(err) => {
                eprintln!("api-public : destinataires de {} : {err}", event.kind);
                return;
            }
        };
        for user_id in recipients {
            if let Err(err) = self.deliver_to(definition, &event, user_id).await {
                eprintln!("api-public : notification {} : {err}", event.kind);
            }
        }
    }

    async fn deliver_to(
        &self,
        definition: &EventDefinition,
        event: &Event,
        user_id: Uuid,
    ) -> Result<(), StoreError> {
        let Some(user) = self.store.find_user_by_id(user_id).await? else {
            return Ok(());
        };
        let settings = self
            .store
            .user_settings(user_id)
            .await?
            .unwrap_or_else(UserSettings::defaults);
        let (title, body) = localized(definition, settings.language, &event.payload);
        let path = definition.path.map(|path| render(path, &event.payload));
        for &channel in definition.channels {
            if !settings.allows(definition.category, channel) {
                continue;
            }
            match channel {
                Channel::Email => {
                    // Seule une adresse vérifiée reçoit des notifications facultatives.
                    let (true, Some(address), Some(_)) = (
                        self.mailer.available(),
                        &user.email,
                        &user.email_verified_at,
                    ) else {
                        continue;
                    };
                    let mail = NotificationMail {
                        language: settings.language,
                        category: definition.category,
                        title: title.clone(),
                        body: body.clone(),
                        action_url: path
                            .as_ref()
                            .map(|path| format!("{}{path}", self.public_url.trim_end_matches('/'))),
                    };
                    self.once(event, user_id, channel, || self.send_email(address, &mail))
                        .await?;
                }
                Channel::Push => {
                    if !self.push.available() {
                        continue;
                    }
                    let mut data = match &event.payload {
                        Value::Object(map) => map.clone(),
                        _ => Map::new(),
                    };
                    data.insert("kind".into(), json!(definition.kind));
                    data.insert("category".into(), json!(definition.category.as_str()));
                    data.insert("path".into(), json!(path));
                    let data = Value::Object(data);
                    self.once(event, user_id, channel, || {
                        self.send_push(user_id, &title, &body, &data)
                    })
                    .await?;
                }
            }
        }
        Ok(())
    }

    /// Réserve la livraison, l'exécute, et libère la réservation si elle échoue (ou n'avait
    /// personne à qui s'adresser) pour qu'un nouvel envoi de l'événement puisse réussir.
    async fn once<F, Fut>(
        &self,
        event: &Event,
        user_id: Uuid,
        channel: Channel,
        send: F,
    ) -> Result<(), StoreError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = bool>,
    {
        if !self
            .store
            .claim_notification(&event.key, user_id, channel)
            .await?
        {
            return Ok(());
        }
        if !send().await {
            self.store
                .release_notification(&event.key, user_id, channel)
                .await?;
        }
        Ok(())
    }

    async fn send_email(&self, to: &str, mail: &NotificationMail) -> bool {
        for attempt in 1..=MAX_ATTEMPTS {
            match self.mailer.send_notification(to, mail).await {
                Ok(()) => return true,
                Err(err) => {
                    eprintln!("api-public : e-mail de notification (essai {attempt}) : {err}");
                    self.pause(attempt).await;
                }
            }
        }
        false
    }

    /// `true` si au moins un appareil a reçu la notification. Les jetons que le service ne
    /// reconnaît plus sont supprimés.
    async fn send_push(&self, user_id: Uuid, title: &str, body: &str, data: &Value) -> bool {
        let tokens = match self.store.list_push_tokens(user_id).await {
            Ok(tokens) => tokens,
            Err(err) => {
                eprintln!("api-public : appareils push : {err}");
                return false;
            }
        };
        let mut delivered = false;
        for device in tokens {
            for attempt in 1..=MAX_ATTEMPTS {
                match self.push.send(&device.token, title, body, data).await {
                    Ok(()) => {
                        delivered = true;
                        break;
                    }
                    Err(PushError::InvalidToken) => {
                        if let Err(err) = self.store.remove_push_token(&device.token).await {
                            eprintln!("api-public : suppression d'un jeton push : {err}");
                        }
                        break;
                    }
                    Err(PushError::Transient(detail)) => {
                        eprintln!("api-public : push (essai {attempt}) : {detail}");
                        self.pause(attempt).await;
                    }
                    Err(PushError::Rejected(detail)) => {
                        eprintln!("api-public : push refusé : {detail}");
                        break;
                    }
                }
            }
        }
        delivered
    }

    async fn pause(&self, attempt: u32) {
        if attempt < MAX_ATTEMPTS && !self.retry_delay.is_zero() {
            actix_web::rt::time::sleep(self.retry_delay * attempt).await;
        }
    }

    async fn recipients(&self, audience: &Audience) -> Result<Vec<Uuid>, StoreError> {
        let mut users = Vec::new();
        match audience {
            Audience::Users(ids) => users.extend(ids),
            Audience::Participants(ids) => {
                for &id in ids {
                    if let Some(participant) = self.store.find_participant(id).await? {
                        self.add_participant_users(&mut users, &participant).await?;
                    }
                }
            }
            Audience::Tournament(tournament_id) => {
                let mut offset = 0;
                loop {
                    let page = self
                        .store
                        .list_participants(*tournament_id, PAGE, offset)
                        .await?;
                    for participant in &page {
                        if !matches!(
                            participant.status,
                            ParticipantStatus::Withdrawn | ParticipantStatus::Disqualified
                        ) {
                            self.add_participant_users(&mut users, participant).await?;
                        }
                    }
                    if i64::try_from(page.len()).unwrap_or(0) < PAGE {
                        break;
                    }
                    offset += PAGE;
                }
            }
        }
        let mut seen = HashSet::new();
        users.retain(|id| seen.insert(*id));
        Ok(users)
    }

    async fn add_participant_users(
        &self,
        users: &mut Vec<Uuid>,
        participant: &TournamentParticipant,
    ) -> Result<(), StoreError> {
        users.extend(participant.user_id);
        if let Some(team_id) = participant.tournament_team_id {
            let members = self
                .store
                .list_tournament_team_members(team_id)
                .await?
                .unwrap_or_default();
            users.extend(members.into_iter().map(|member| member.user_id));
        }
        Ok(())
    }
}

// --- Constructeurs des événements intégrés ---------------------------------------------------

/// Changement de statut d'un tournoi ; `None` pour les statuts qui n'ont pas d'événement.
pub fn tournament_status(tournament: &Tournament, status: TournamentStatus) -> Option<Event> {
    let kind = match status {
        TournamentStatus::Ongoing => "tournament.started",
        TournamentStatus::Finished => "tournament.finished",
        TournamentStatus::Cancelled => "tournament.cancelled",
        _ => return None,
    };
    Some(Event {
        kind,
        key: format!("{kind}:{}", tournament.id),
        audience: Audience::Tournament(tournament.id),
        payload: tournament_payload(tournament),
    })
}

fn tournament_payload(tournament: &Tournament) -> Value {
    json!({"tournament_id": tournament.id, "tournament_name": tournament.name})
}

pub fn participant_disqualified(tournament: &Tournament, participant_id: Uuid) -> Event {
    Event {
        kind: "tournament.disqualified",
        key: format!("tournament.disqualified:{participant_id}"),
        audience: Audience::Participants(vec![participant_id]),
        payload: tournament_payload(tournament),
    }
}

/// `stamp` distingue deux arrivées successives du même compte dans la même équipe.
pub fn team_member_added(team_id: Uuid, team_name: &str, user_id: Uuid, stamp: &str) -> Event {
    Event {
        kind: "team.member_added",
        key: format!("team.member_added:{team_id}:{user_id}:{stamp}"),
        audience: Audience::Users(vec![user_id]),
        payload: json!({"team_id": team_id, "team_name": team_name}),
    }
}

pub fn team_member_removed(team_id: Uuid, team_name: &str, user_id: Uuid, stamp: &str) -> Event {
    Event {
        kind: "team.member_removed",
        key: format!("team.member_removed:{team_id}:{user_id}:{stamp}"),
        audience: Audience::Users(vec![user_id]),
        payload: json!({"team_id": team_id, "team_name": team_name}),
    }
}

/// `kind` vaut `match.started` ou `match.finished`.
pub fn match_event(
    kind: &'static str,
    tournament: &Tournament,
    step_id: Uuid,
    match_id: Uuid,
    participant_ids: Vec<Uuid>,
) -> Event {
    Event {
        kind,
        key: format!("{kind}:{match_id}"),
        audience: Audience::Participants(participant_ids),
        payload: json!({
            "tournament_id": tournament.id,
            "tournament_name": tournament.name,
            "step_id": step_id,
            "match_id": match_id,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rendering_fills_variables() {
        let payload = json!({"name": "Open", "n": 3, "skip": null});
        assert_eq!(render("{name} #{n}{skip}!", &payload), "Open #3!");
        assert_eq!(render("{missing}x", &payload), "x");
        assert_eq!(render("sans variable", &payload), "sans variable");
        assert_eq!(render("ouvert {", &payload), "ouvert {");
        assert_eq!(render("é{name}é", &payload), "éOpené");
    }

    #[test]
    fn every_builtin_event_is_localized_and_consistent() {
        let catalog = Catalog::builtin();
        assert_eq!(catalog.kinds().len(), BUILTIN.len());
        let payload = json!({
            "tournament_name": "Open", "team_name": "Les Aigles",
            "tournament_id": "t", "step_id": "s",
        });
        for kind in catalog.kinds() {
            let definition = catalog.get(kind).unwrap();
            assert!(kind.contains('.'), "{kind}");
            let titles: HashSet<_> = Language::ALL
                .iter()
                .map(|&language| {
                    let (title, body) = localized(definition, language, &payload);
                    assert!(!title.is_empty() && !body.is_empty(), "{kind} {language:?}");
                    assert!(!title.contains('{') && !body.contains('{'), "{kind}");
                    title
                })
                .collect();
            assert_eq!(titles.len(), 3, "{kind} : trois langues distinctes");
        }
    }

    #[test]
    fn registering_refuses_duplicates() {
        let mut catalog = Catalog::builtin();
        let custom = EventDefinition {
            kind: "pickem.result",
            category: Category::Pickem,
            channels: BOTH,
            texts: [("a", "a"), ("b", "b"), ("c", "c")],
            path: None,
        };
        assert!(catalog.register(custom.clone()));
        assert!(!catalog.register(custom));
        assert!(catalog.get("pickem.result").is_some());
    }
}
