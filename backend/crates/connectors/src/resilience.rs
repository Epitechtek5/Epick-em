//! Résilience commune à tous les connecteurs (ADR-003) : limite de requêtes par fournisseur
//! (seau à jetons), reprises avec backoff exponentiel et gigue, disjoncteur, et cache des
//! lectures interactives (recherche, épreuves) avec repli sur la dernière réponse connue
//! pendant une panne.
//!
//! [`ResilientConnector`] enveloppe n'importe quel connecteur et implémente lui-même
//! [`TournamentConnector`] : le reste du code ne voit pas la différence.
//!
//! `fetch` et `fetch_updates` ne sont pas servis depuis ce cache : la synchronisation garde
//! elle-même le dernier instantané réussi en base et l'affiche pendant une panne
//! ([`crate::sync`]). Elles profitent des reprises, de la limite et du disjoncteur.

use crate::connector::{ConnectorError, TournamentConnector};
use crate::model::{
    Capabilities, ExternalDelta, ExternalEventRef, ExternalTournament, ExternalTournamentRef,
    SyncCursor,
};
use async_trait::async_trait;
use infra::{Cache, Ttl};
use serde::Serialize;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use std::collections::hash_map::RandomState;
use std::future::Future;
use std::hash::BuildHasher;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;

/// Réglages de la résilience d'un connecteur.
#[derive(Debug, Clone)]
pub struct ResiliencePolicy {
    /// Requêtes autorisées par fenêtre (`rate_window`), tous appels confondus.
    pub rate_limit: u32,
    pub rate_window: Duration,
    /// Nouvelles tentatives après une erreur transitoire.
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
    /// Échecs transitoires consécutifs qui ouvrent le disjoncteur.
    pub failure_threshold: u32,
    /// Durée pendant laquelle la source n'est plus appelée.
    pub open_for: Duration,
    /// Durée de fraîcheur d'une réponse en cache.
    pub cache_ttl: Ttl,
    /// Durée de conservation de la dernière réponse connue, servie pendant une panne.
    pub stale_ttl: Ttl,
}

impl Default for ResiliencePolicy {
    /// start.gg documente 80 requêtes par minute : on reste en dessous.
    fn default() -> Self {
        ResiliencePolicy {
            rate_limit: 60,
            rate_window: Duration::from_secs(60),
            max_retries: 3,
            base_delay: Duration::from_millis(500),
            max_delay: Duration::from_secs(30),
            failure_threshold: 5,
            open_for: Duration::from_secs(60),
            cache_ttl: Ttl::from_mins(5),
            stale_ttl: Ttl::from_hours(24 * 7),
        }
    }
}

/// Seau à jetons : `capacity` jetons, rechargés uniformément sur `window`.
struct TokenBucket {
    capacity: f64,
    per_sec: f64,
    tokens: f64,
    last: Instant,
}

impl TokenBucket {
    fn new(capacity: u32, window: Duration) -> Self {
        let capacity = f64::from(capacity.max(1));
        TokenBucket {
            capacity,
            per_sec: capacity / window.as_secs_f64().max(0.001),
            tokens: capacity,
            last: Instant::now(),
        }
    }

    /// Prend un jeton, ou indique l'attente nécessaire.
    fn take(&mut self) -> Option<Duration> {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.per_sec).min(self.capacity);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            None
        } else {
            Some(Duration::from_secs_f64((1.0 - self.tokens) / self.per_sec))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreakerState {
    Closed,
    Open,
    /// Délai écoulé : une requête d'essai passe.
    HalfOpen,
}

struct Breaker {
    failures: u32,
    open_until: Option<Instant>,
}

/// Connecteur enveloppé dans la résilience commune.
pub struct ResilientConnector {
    inner: Arc<dyn TournamentConnector>,
    policy: ResiliencePolicy,
    cache: Option<Arc<dyn Cache>>,
    bucket: Mutex<TokenBucket>,
    breaker: Mutex<Breaker>,
    jitter: RandomState,
}

impl ResilientConnector {
    pub fn new(
        inner: Arc<dyn TournamentConnector>,
        policy: ResiliencePolicy,
        cache: Option<Arc<dyn Cache>>,
    ) -> Self {
        ResilientConnector {
            bucket: Mutex::new(TokenBucket::new(policy.rate_limit, policy.rate_window)),
            breaker: Mutex::new(Breaker {
                failures: 0,
                open_until: None,
            }),
            jitter: RandomState::new(),
            inner,
            policy,
            cache,
        }
    }

    pub fn breaker_state(&self) -> BreakerState {
        let breaker = self.breaker.lock().unwrap_or_else(|e| e.into_inner());
        match breaker.open_until {
            None => BreakerState::Closed,
            Some(until) if Instant::now() < until => BreakerState::Open,
            Some(_) => BreakerState::HalfOpen,
        }
    }

    async fn acquire(&self) {
        loop {
            let wait = self.bucket.lock().unwrap_or_else(|e| e.into_inner()).take();
            match wait {
                None => return,
                Some(wait) => tokio::time::sleep(wait).await,
            }
        }
    }

    fn record(&self, outcome: &Result<(), &ConnectorError>) {
        let mut breaker = self.breaker.lock().unwrap_or_else(|e| e.into_inner());
        match outcome {
            Ok(()) => {
                breaker.failures = 0;
                breaker.open_until = None;
            }
            Err(err) if err.is_transient() => {
                breaker.failures += 1;
                // En demi-ouverture, un seul échec suffit à rouvrir.
                if breaker.failures >= self.policy.failure_threshold || breaker.open_until.is_some()
                {
                    breaker.open_until = Some(Instant::now() + self.policy.open_for);
                }
            }
            // Une erreur définitive (introuvable, URL refusée) ne dit rien de la santé de la
            // source.
            Err(_) => {}
        }
    }

    fn delay(&self, attempt: u32, err: &ConnectorError) -> Duration {
        if let ConnectorError::RateLimited {
            retry_after: Some(after),
        } = err
        {
            return (*after).min(self.policy.max_delay);
        }
        let exponential = self
            .policy
            .base_delay
            .saturating_mul(2u32.saturating_pow(attempt))
            .min(self.policy.max_delay);
        // Gigue « égale » : entre la moitié et la totalité du délai.
        let half = exponential / 2;
        let random = self.jitter.hash_one((attempt, Instant::now()));
        let extra = half.mul_f64((random % 1000) as f64 / 1000.0);
        half + extra
    }

    /// Appelle `op` avec limite, reprises et disjoncteur.
    async fn call<T, F, Fut>(&self, op: F) -> Result<T, ConnectorError>
    where
        F: Fn() -> Fut,
        Fut: Future<Output = Result<T, ConnectorError>>,
    {
        let mut attempt = 0;
        loop {
            if self.breaker_state() == BreakerState::Open {
                return Err(ConnectorError::CircuitOpen);
            }
            self.acquire().await;
            let result = op().await;
            self.record(&result.as_ref().map(|_| ()));
            match result {
                Err(err) if err.is_transient() && attempt < self.policy.max_retries => {
                    tokio::time::sleep(self.delay(attempt, &err)).await;
                    attempt += 1;
                }
                other => return other,
            }
        }
    }

    fn key(&self, op: &str, args: &str) -> String {
        let digest = Sha256::digest(args.as_bytes());
        let hex: String = digest.iter().take(16).map(|b| format!("{b:02x}")).collect();
        format!("connector:{}:{op}:{hex}", self.inner.id())
    }

    async fn read<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let bytes = self.cache.as_ref()?.get(key).await.ok()??;
        serde_json::from_slice(&bytes).ok()
    }

    async fn write<T: Serialize>(&self, key: &str, value: &T, ttl: Ttl) {
        if let (Some(cache), Ok(bytes)) = (&self.cache, serde_json::to_vec(value)) {
            // Le cache n'est qu'une optimisation : une panne de Redis n'empêche rien.
            let _ = cache.set(key, bytes, ttl).await;
        }
    }

    /// Lecture interactive : cache frais, sinon la source, sinon (panne) la dernière réponse
    /// connue.
    async fn cached<T, F, Fut>(&self, op: &str, args: &str, fetch: F) -> Result<T, ConnectorError>
    where
        T: Serialize + DeserializeOwned,
        F: Fn() -> Fut,
        Fut: Future<Output = Result<T, ConnectorError>>,
    {
        let fresh = self.key(op, args);
        let stale = format!("{fresh}:stale");
        if let Some(value) = self.read(&fresh).await {
            return Ok(value);
        }
        match self.call(fetch).await {
            Ok(value) => {
                self.write(&fresh, &value, self.policy.cache_ttl).await;
                self.write(&stale, &value, self.policy.stale_ttl).await;
                Ok(value)
            }
            Err(err) if err.is_transient() || err == ConnectorError::CircuitOpen => {
                match self.read(&stale).await {
                    Some(value) => Ok(value),
                    None => Err(err),
                }
            }
            Err(err) => Err(err),
        }
    }
}

#[async_trait]
impl TournamentConnector for ResilientConnector {
    fn id(&self) -> &'static str {
        self.inner.id()
    }

    fn display_name(&self) -> &'static str {
        self.inner.display_name()
    }

    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }

    async fn search(&self, query: &str) -> Result<Vec<ExternalTournamentRef>, ConnectorError> {
        let normalized = query.trim().to_lowercase();
        self.cached("search", &normalized, || self.inner.search(query))
            .await
    }

    async fn resolve_url(&self, url: &str) -> Result<ExternalTournamentRef, ConnectorError> {
        self.cached("resolve", url.trim(), || self.inner.resolve_url(url))
            .await
    }

    async fn list_events(
        &self,
        tournament: &ExternalTournamentRef,
    ) -> Result<Vec<ExternalEventRef>, ConnectorError> {
        self.cached("events", &tournament.external_id, || {
            self.inner.list_events(tournament)
        })
        .await
    }

    async fn fetch(
        &self,
        tournament: &ExternalTournamentRef,
        event_ids: &[String],
    ) -> Result<ExternalTournament, ConnectorError> {
        self.call(|| self.inner.fetch(tournament, event_ids)).await
    }

    async fn fetch_updates(
        &self,
        tournament: &ExternalTournamentRef,
        event_ids: &[String],
        cursor: SyncCursor,
    ) -> Result<ExternalDelta, ConnectorError> {
        self.call(|| self.inner.fetch_updates(tournament, event_ids, cursor))
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CompetitionState;
    use infra::MemoryCache;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Source scriptée : chaque appel consomme la réponse suivante.
    #[derive(Default)]
    struct Scripted {
        responses: Mutex<VecDeque<Result<(), ConnectorError>>>,
        calls: AtomicU32,
    }

    impl Scripted {
        fn with(responses: Vec<Result<(), ConnectorError>>) -> Arc<Self> {
            Arc::new(Scripted {
                responses: Mutex::new(responses.into()),
                calls: AtomicU32::new(0),
            })
        }

        fn next(&self) -> Result<(), ConnectorError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.responses.lock().unwrap().pop_front().unwrap_or(Ok(()))
        }

        fn calls(&self) -> u32 {
            self.calls.load(Ordering::SeqCst)
        }
    }

    fn reference(name: &str) -> ExternalTournamentRef {
        ExternalTournamentRef {
            provider: "scripted".into(),
            external_id: "1".into(),
            slug: None,
            name: name.into(),
            url: None,
            starts_at: None,
            ends_at: None,
        }
    }

    #[async_trait]
    impl TournamentConnector for Scripted {
        fn id(&self) -> &'static str {
            "scripted"
        }
        fn display_name(&self) -> &'static str {
            "Scripted"
        }
        fn capabilities(&self) -> Capabilities {
            Capabilities::default()
        }
        async fn search(&self, query: &str) -> Result<Vec<ExternalTournamentRef>, ConnectorError> {
            self.next().map(|()| vec![reference(query)])
        }
        async fn resolve_url(&self, _: &str) -> Result<ExternalTournamentRef, ConnectorError> {
            self.next().map(|()| reference("url"))
        }
        async fn list_events(
            &self,
            _: &ExternalTournamentRef,
        ) -> Result<Vec<ExternalEventRef>, ConnectorError> {
            self.next().map(|()| Vec::new())
        }
        async fn fetch(
            &self,
            r: &ExternalTournamentRef,
            _: &[String],
        ) -> Result<ExternalTournament, ConnectorError> {
            self.next().map(|()| ExternalTournament {
                reference: r.clone(),
                state: CompetitionState::Active,
                events: Vec::new(),
            })
        }
    }

    fn policy() -> ResiliencePolicy {
        ResiliencePolicy {
            rate_limit: 1000,
            failure_threshold: 3,
            ..ResiliencePolicy::default()
        }
    }

    fn unavailable() -> Result<(), ConnectorError> {
        Err(ConnectorError::Unavailable("panne".into()))
    }

    #[tokio::test(start_paused = true)]
    async fn transient_errors_are_retried_with_backoff() {
        let source = Scripted::with(vec![Err(ConnectorError::Timeout), unavailable()]);
        let connector = ResilientConnector::new(source.clone(), policy(), None);
        let started = Instant::now();
        assert!(connector.fetch(&reference("t"), &[]).await.is_ok());
        assert_eq!(source.calls(), 3);
        // 2 reprises : au moins 250 ms puis 500 ms (moitié basse de la gigue).
        assert!(started.elapsed() >= Duration::from_millis(750));
    }

    #[tokio::test(start_paused = true)]
    async fn definitive_errors_are_not_retried() {
        let source = Scripted::with(vec![Err(ConnectorError::NotFound)]);
        let connector = ResilientConnector::new(source.clone(), policy(), None);
        assert_eq!(
            connector.fetch(&reference("t"), &[]).await.unwrap_err(),
            ConnectorError::NotFound
        );
        assert_eq!(source.calls(), 1);
        assert_eq!(connector.breaker_state(), BreakerState::Closed);
    }

    #[tokio::test(start_paused = true)]
    async fn rate_limit_responses_wait_for_retry_after() {
        let source = Scripted::with(vec![Err(ConnectorError::RateLimited {
            retry_after: Some(Duration::from_secs(7)),
        })]);
        let connector = ResilientConnector::new(source.clone(), policy(), None);
        let started = Instant::now();
        assert!(connector.fetch(&reference("t"), &[]).await.is_ok());
        assert!(started.elapsed() >= Duration::from_secs(7));
    }

    #[tokio::test(start_paused = true)]
    async fn the_bucket_spaces_out_requests() {
        let source = Scripted::with(Vec::new());
        let connector = ResilientConnector::new(
            source.clone(),
            ResiliencePolicy {
                rate_limit: 2,
                rate_window: Duration::from_secs(10),
                ..policy()
            },
            None,
        );
        let started = Instant::now();
        for _ in 0..4 {
            connector.fetch(&reference("t"), &[]).await.unwrap();
        }
        // 2 jetons d'avance, puis un toutes les 5 s.
        assert!(started.elapsed() >= Duration::from_secs(10));
        assert_eq!(source.calls(), 4);
    }

    #[tokio::test(start_paused = true)]
    async fn the_circuit_opens_then_half_opens() {
        let source = Scripted::with(vec![unavailable(); 4]);
        let connector = ResilientConnector::new(
            source.clone(),
            ResiliencePolicy {
                max_retries: 0,
                ..policy()
            },
            None,
        );
        for _ in 0..3 {
            assert!(connector.fetch(&reference("t"), &[]).await.is_err());
        }
        assert_eq!(connector.breaker_state(), BreakerState::Open);
        assert_eq!(
            connector.fetch(&reference("t"), &[]).await.unwrap_err(),
            ConnectorError::CircuitOpen
        );
        assert_eq!(source.calls(), 3, "plus d'appel pendant l'ouverture");

        tokio::time::advance(Duration::from_secs(61)).await;
        assert_eq!(connector.breaker_state(), BreakerState::HalfOpen);
        // L'essai échoue : le disjoncteur se rouvre aussitôt.
        assert!(connector.fetch(&reference("t"), &[]).await.is_err());
        assert_eq!(connector.breaker_state(), BreakerState::Open);
        tokio::time::advance(Duration::from_secs(61)).await;
        // L'essai réussit : refermé.
        assert!(connector.fetch(&reference("t"), &[]).await.is_ok());
        assert_eq!(connector.breaker_state(), BreakerState::Closed);
    }

    #[tokio::test(start_paused = true)]
    async fn interactive_reads_are_cached_and_served_stale_during_outages() {
        let source = Scripted::with(vec![
            Ok(()),
            unavailable(),
            unavailable(),
            unavailable(),
            unavailable(),
        ]);
        let cache = Arc::new(MemoryCache::new());
        let connector = ResilientConnector::new(
            source.clone(),
            ResiliencePolicy {
                max_retries: 1,
                ..policy()
            },
            Some(cache.clone()),
        );
        let first = connector.search(" Genesis ").await.unwrap();
        // Fraîche : pas d'appel ; casse et espaces ignorés.
        assert_eq!(connector.search("genesis").await.unwrap(), first);
        assert_eq!(source.calls(), 1);

        cache
            .delete(&[&connector.key("search", "genesis")])
            .await
            .unwrap();
        // Source en panne : la dernière réponse connue est servie.
        assert_eq!(connector.search("genesis").await.unwrap(), first);
        assert_eq!(source.calls(), 3);
        // Sans réponse connue, l'erreur remonte.
        assert!(connector.search("autre").await.is_err());
    }
}
