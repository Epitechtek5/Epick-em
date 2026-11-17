//! Analyse des URL start.gg. Seuls les hôtes de start.gg (et de l'ancien smash.gg) sont
//! acceptés ; on n'en garde que le slug du tournoi, et la requête part toujours vers l'API fixe
//! de start.gg : une URL fournie par un utilisateur n'est jamais appelée (pas de SSRF).

use crate::connector::ConnectorError;

const HOSTS: [&str; 4] = ["start.gg", "www.start.gg", "smash.gg", "www.smash.gg"];
const MAX_SLUG: usize = 128;

/// Slug d'un tournoi : minuscules, chiffres et tirets.
pub fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= MAX_SLUG
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !slug.starts_with('-')
}

/// Slug du tournoi désigné par `input` : URL `https://start.gg/tournament/<slug>/…`, chemin
/// `tournament/<slug>`, ou slug seul.
pub fn tournament_slug(input: &str) -> Result<String, ConnectorError> {
    let invalid = |why: &str| ConnectorError::InvalidUrl(why.to_string());
    let input = input.trim();
    if input.len() > 2048 {
        return Err(invalid("URL trop longue"));
    }
    let path = if input.contains("://") {
        let url = url::Url::parse(input).map_err(|_| invalid("URL illisible"))?;
        if url.scheme() != "https" && url.scheme() != "http" {
            return Err(invalid("schéma non pris en charge"));
        }
        if url.username() != "" || url.password().is_some() || url.port().is_some() {
            return Err(invalid("URL start.gg inattendue"));
        }
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        if !HOSTS.contains(&host.as_str()) {
            return Err(invalid("hôte autre que start.gg"));
        }
        url.path().to_string()
    } else {
        input.to_string()
    };
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let slug = match segments.as_slice() {
        ["tournament", slug, ..] => slug,
        [slug] if !input.contains("://") => slug,
        _ => return Err(invalid("pas une page de tournoi start.gg")),
    };
    let slug = slug.to_ascii_lowercase();
    if valid_slug(&slug) {
        Ok(slug)
    } else {
        Err(invalid("slug de tournoi invalide"))
    }
}

/// URL publique d'un chemin start.gg (`tournament/x`, `tournament/x/event/y`).
pub fn public_url(path: &str) -> String {
    format!("https://www.start.gg/{}", path.trim_start_matches('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_start_gg_tournament_urls_and_slugs() {
        for (input, slug) in [
            (
                "https://www.start.gg/tournament/genesis-10/details",
                "genesis-10",
            ),
            ("https://start.gg/tournament/Genesis-10", "genesis-10"),
            (
                "https://www.start.gg/tournament/evo-2025/event/ultimate-singles",
                "evo-2025",
            ),
            (
                "https://smash.gg/tournament/the-big-house-6",
                "the-big-house-6",
            ),
            ("tournament/genesis-10", "genesis-10"),
            ("genesis-10", "genesis-10"),
            (
                "  https://www.start.gg/tournament/genesis-10?tab=x#y  ",
                "genesis-10",
            ),
        ] {
            assert_eq!(tournament_slug(input).unwrap(), slug, "{input}");
        }
    }

    #[test]
    fn rejects_other_hosts_and_odd_urls() {
        for input in [
            "https://evil.example/tournament/genesis-10",
            "https://start.gg.evil.example/tournament/x",
            "https://start.gg@evil.example/tournament/x",
            "https://user:pw@start.gg/tournament/x",
            "https://start.gg:8443/tournament/x",
            "http://169.254.169.254/latest/meta-data",
            "file:///etc/passwd",
            "ftp://start.gg/tournament/x",
            "https://start.gg/user/abc",
            "https://start.gg/",
            "https://start.gg/tournament/../admin",
            "https://start.gg/tournament/a%2Fb",
            "tournament/x y",
            "",
            &format!("https://start.gg/tournament/{}", "a".repeat(200)),
        ] {
            assert!(
                matches!(tournament_slug(input), Err(ConnectorError::InvalidUrl(_))),
                "{input}"
            );
        }
    }
}
