//! Durée de vie d'une entrée de cache : obligatoire, en secondes entières, jamais nulle.

use std::num::NonZeroU64;
use std::time::Duration;

/// Durée de vie d'une entrée de cache. Toute écriture en cache en exige une : aucune
/// entrée ne vit indéfiniment, ce qui borne la durée d'une valeur périmée.
///
/// Un TTL nul est refusé à la compilation quand il est défini en constante :
///
/// ```compile_fail
/// const _: infra::Ttl = infra::Ttl::from_secs(0);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Ttl(NonZeroU64);

impl Ttl {
    /// Panique si `secs` vaut 0 (erreur de compilation dans un contexte `const`).
    pub const fn from_secs(secs: u64) -> Self {
        match NonZeroU64::new(secs) {
            Some(secs) => Ttl(secs),
            None => panic!("un TTL de cache doit être d'au moins une seconde"),
        }
    }

    pub const fn from_mins(mins: u64) -> Self {
        Self::from_secs(mins * 60)
    }

    pub const fn from_hours(hours: u64) -> Self {
        Self::from_secs(hours * 3600)
    }

    /// Variante sans panique, pour un TTL venu de la configuration.
    pub const fn try_from_secs(secs: u64) -> Option<Self> {
        match NonZeroU64::new(secs) {
            Some(secs) => Some(Ttl(secs)),
            None => None,
        }
    }

    pub const fn as_secs(self) -> u64 {
        self.0.get()
    }

    pub const fn as_duration(self) -> Duration {
        Duration::from_secs(self.0.get())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructors() {
        assert_eq!(Ttl::from_secs(90).as_secs(), 90);
        assert_eq!(Ttl::from_mins(5).as_secs(), 300);
        assert_eq!(Ttl::from_hours(2).as_duration(), Duration::from_secs(7200));
        assert_eq!(Ttl::try_from_secs(0), None);
        assert_eq!(Ttl::try_from_secs(1), Some(Ttl::from_secs(1)));
    }

    #[test]
    #[should_panic(expected = "au moins une seconde")]
    fn zero_panics_at_runtime() {
        let secs = std::hint::black_box(0);
        Ttl::from_secs(secs);
    }
}
