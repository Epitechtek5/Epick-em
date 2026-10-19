//! Logique métier pure : moteur de tournoi, barème, résolution Pick'em.
//!
//! Cette crate ne fait aucune I/O (pas de réseau, pas de base de données)
//! afin d'être entièrement testable et partagée par tous les binaires.

/// Version du domaine, exposée par les services pour le diagnostic.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!VERSION.is_empty());
    }
}
