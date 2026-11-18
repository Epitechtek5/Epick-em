//! Logique métier pure : moteur de tournoi, barème, résolution Pick'em.
//!
//! Cette crate ne fait aucune I/O (pas de réseau, pas de base de données)
//! afin d'être entièrement testable et partagée par tous les binaires.

pub mod bracket;
pub mod seeding;
pub mod standings;
pub mod swiss;

/// Version du domaine, exposée par les services pour le diagnostic.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_has_a_semver_core() {
        let components = VERSION.split('.').collect::<Vec<_>>();

        assert_eq!(components.len(), 3);
        assert!(
            components
                .iter()
                .all(|component| component.parse::<u64>().is_ok())
        );
    }
}
