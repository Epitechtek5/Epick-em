//! Sources de tournois externes : trait `TournamentConnector` et connecteur start.gg.

/// Source externe capable de fournir des tournois (start.gg, …).
pub trait TournamentConnector {
    /// Identifiant court de la source, ex. `"startgg"`.
    fn name(&self) -> &'static str;
}
