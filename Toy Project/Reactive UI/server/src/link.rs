//! The title and picture behind a link to a movie, show or exhibition page, read the way a
//! messenger builds a link preview (og:title / og:image). Best effort: anything that fails just
//! means the planner types the title or uploads the poster.
//!
//! Only the planner can ask for this, but the server still refuses links that point at itself or
//! a private network by name, and reads at most the first megabyte of a page.

use std::{sync::LazyLock, time::Duration};

use reqwest::{Client, Url, redirect::Policy};

const UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 \
                  (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAX_PAGE: usize = 1024 * 1024;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Preview {
    pub title: Option<String>,
    pub image: Option<String>,
}

/// A public web address: http(s), a dotted host name, not an IP literal or localhost.
fn public(url: &Url) -> bool {
    let Some(h) = url.host_str() else {
        return false;
    };
    let h = h.to_ascii_lowercase();
    matches!(url.scheme(), "http" | "https")
        && h.contains('.')
        && !h.starts_with('[')
        && h.parse::<std::net::IpAddr>().is_err()
        && !["localhost", ".localhost", ".local", ".internal"]
            .iter()
            .any(|s| h == s.trim_start_matches('.') || h.ends_with(s))
}

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(8))
        .redirect(Policy::custom(|a| {
            if a.previous().len() >= 4 || !public(a.url()) {
                a.stop()
            } else {
                a.follow()
            }
        }))
        .build()
        .inspect_err(|e| tracing::warn!("link: no http client: {e}"))
        .ok()
});

/// The preview of a page, or an empty one.
pub async fn preview(link: &str) -> Preview {
    match fetch(link).await {
        Ok(p) => p,
        Err(e) => {
            tracing::info!("link preview for {link}: {e:#}");
            Preview::default()
        }
    }
}

async fn fetch(link: &str) -> anyhow::Result<Preview> {
    let url = Url::parse(link)?;
    anyhow::ensure!(public(&url), "not a public address");
    let client = CLIENT
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no http client"))?;
    let mut res = client.get(url).send().await?;
    anyhow::ensure!(res.status().is_success(), "status {}", res.status());
    let page = res.url().clone();
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await? {
        body.extend_from_slice(&chunk);
        if body.len() >= MAX_PAGE {
            break;
        }
    }
    Ok(parse(&String::from_utf8_lossy(&body), &page))
}

/// og:/twitter: title and image from a page's <meta> tags (or its <title>).
fn parse(html: &str, page: &Url) -> Preview {
    let mut title = None;
    let mut image = None;
    let lower = html.to_ascii_lowercase();
    let mut at = 0;
    while let Some(i) = lower[at..].find("<meta") {
        let start = at + i;
        let Some(len) = lower[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + len];
        at = start + len;
        let attrs = attributes(tag);
        let key = attrs
            .iter()
            .find(|(k, _)| k == "property" || k == "name")
            .map(|(_, v)| v.to_ascii_lowercase());
        let Some(content) = attrs.iter().find(|(k, _)| k == "content").map(|(_, v)| v) else {
            continue;
        };
        match key.as_deref() {
            Some("og:title") => title = Some(content.clone()),
            Some("twitter:title") if title.is_none() => title = Some(content.clone()),
            Some("og:image" | "og:image:url" | "og:image:secure_url") if image.is_none() => {
                image = Some(content.clone())
            }
            Some("twitter:image") if image.is_none() => image = Some(content.clone()),
            _ => {}
        }
    }
    if title.is_none()
        && let (Some(a), Some(b)) = (lower.find("<title"), lower.find("</title>"))
        && let Some(open) = lower[a..b].find('>')
    {
        title = Some(decode(&html[a + open + 1..b]));
    }
    // search pages have one picture for every query: not a poster
    let host = page.host_str().unwrap_or_default();
    let searching = host.starts_with("search.") || host.contains(".search.");
    Preview {
        title: title.map(|t| clean_title(&t)).filter(|t| !t.is_empty()),
        image: image
            .filter(|_| !searching)
            .and_then(|i| absolute(&i, page))
            .filter(|i| i.len() <= 800),
    }
}

/// name="value" pairs of one tag ('…', "…" or bare values), names lowercased, values decoded.
fn attributes(tag: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let b = tag.as_bytes();
    let mut i = tag.find(char::is_whitespace).unwrap_or(tag.len());
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        let ks = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'/' {
            i += 1;
        }
        let key = tag[ks..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() || b[i] != b'=' {
            if !key.is_empty() {
                out.push((key, String::new()));
            }
            continue;
        }
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let value = if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
            let q = b[i];
            let vs = i + 1;
            let ve = tag[vs..].find(q as char).map_or(tag.len(), |e| vs + e);
            i = (ve + 1).min(b.len());
            &tag[vs..ve]
        } else {
            let vs = i;
            while i < b.len() && !b[i].is_ascii_whitespace() {
                i += 1;
            }
            &tag[vs..i]
        };
        if !key.is_empty() {
            out.push((key, decode(value)));
        }
    }
    out
}

/// The few HTML entities link previews use.
fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        // entity names are ASCII: look for the ';' byte-wise (Korean text around is not)
        let Some(end) = rest.as_bytes()[..rest.len().min(10)]
            .iter()
            .position(|&b| b == b';')
        else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let name = &rest[1..end];
        let ch = match name {
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "nbsp" => Some(' '),
            _ => name
                .strip_prefix("#x")
                .or_else(|| name.strip_prefix("#X"))
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| name.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

/// An https address for the picture (relative ones resolved against the page).
fn absolute(image: &str, page: &Url) -> Option<String> {
    let mut url = page.join(image.trim()).ok()?;
    if url.scheme() == "http" {
        url.set_scheme("https").ok()?;
    }
    (url.scheme() == "https" && public(&url)).then(|| url.to_string())
}

/// "위키드 (2024) - 왓챠피디아" → "위키드": drops the site's name, the year and booking words,
/// and keeps it to 30 characters.
fn clean_title(raw: &str) -> String {
    let mut t = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    for sep in [" - ", " | ", " : "] {
        if let Some(i) = t.rfind(sep) {
            let tail = &t[i + sep.len()..];
            let site = [
                "왓챠피디아",
                "NOL",
                "네이버",
                "메가박스",
                "인터파크",
                "티켓",
                "예스24",
                "CGV",
                "롯데시네마",
            ]
            .iter()
            .any(|s| tail.contains(s));
            if site {
                t.truncate(i);
            }
        }
    }
    for tail in ["일정 및 예매", "예매"] {
        if let Some(rest) = t.strip_suffix(tail) {
            t = rest.trim_end().to_string();
            for kind in [
                "뮤지컬",
                "콘서트",
                "연극",
                "클래식/무용",
                "전시/행사",
                "스포츠",
                "아동/가족",
                "레저/캠핑",
            ] {
                if let Some(r) = t.strip_suffix(kind) {
                    t = r.trim_end().to_string();
                }
            }
            break;
        }
    }
    // "푸른길 (2026)": the year is noise on a card
    if t.ends_with(')')
        && let Some(i) = t.rfind(" (")
        && t[i + 2..t.len() - 1].len() == 4
        && t[i + 2..t.len() - 1].bytes().all(|b| b.is_ascii_digit())
    {
        t.truncate(i);
    }
    t.trim().chars().take(30).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page() -> Url {
        Url::parse("https://pedia.example.com/ko/contents/abc").unwrap()
    }

    #[test]
    fn reads_title_and_poster() {
        let html = r#"<html><head><title>ignored</title>
            <meta property="og:title" content="푸른길 (2026) - 왓챠피디아">
            <meta content='/img/poster.jpg?a=1&amp;b=2' property='og:image' />
            </head></html>"#;
        let p = parse(html, &page());
        assert_eq!(p.title.as_deref(), Some("푸른길"));
        assert_eq!(
            p.image.as_deref(),
            Some("https://pedia.example.com/img/poster.jpg?a=1&b=2")
        );
    }

    #[test]
    fn falls_back_and_cleans() {
        let html = "<title>웍앤올 &amp; 친구들 전시/행사 일정 및 예매 | NOL(야놀자)</title>\
                    <meta name=twitter:image content=http://cdn.example.com/p.gif>";
        let p = parse(html, &page());
        assert_eq!(p.title.as_deref(), Some("웍앤올 & 친구들"));
        assert_eq!(p.image.as_deref(), Some("https://cdn.example.com/p.gif"));
    }

    #[test]
    fn search_pages_have_no_poster() {
        let html = r#"<meta property="og:title" content="위키드 영화 : 네이버 검색">
                      <meta property="og:image" content="https://ssl.example.net/og.png">"#;
        let p = parse(
            html,
            &Url::parse("https://m.search.naver.com/search.naver?q=x").unwrap(),
        );
        assert_eq!(p.title.as_deref(), Some("위키드 영화"));
        assert_eq!(p.image, None);
    }

    #[test]
    fn refuses_private_addresses() {
        for bad in [
            "http://localhost/x",
            "http://127.0.0.1/x",
            "http://[::1]/x",
            "http://intranet/x",
            "file:///etc/passwd",
            "http://printer.local/",
        ] {
            assert!(!public(&Url::parse(bad).unwrap()), "{bad}");
        }
        assert!(public(&Url::parse("https://pedia.watcha.com/ko").unwrap()));
    }
}
