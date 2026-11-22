//! Food photos and the location of a candidate, from its Naver Map link.
//!
//! A Naver place page embeds its data as JSON: the menu (with the photos the place uploaded) and
//! the top photo strip (visitors' photos, tagged by what they show). We read that page the way a
//! link preview would, list the food photos, and serve them through Naver's own image resizer.
//! Everything is best effort: any failure just means "no photos".

use std::{sync::LazyLock, time::Duration};

use anyhow::Context;
use reqwest::{Client, StatusCode, Url, header::LOCATION, redirect::Policy};
use serde::Serialize;
use serde_json::{Map, Value};

const UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 \
                  (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
/// Square 640 px from Naver's resizer: light on phones, sharp enough for the big swipe card.
const SIZE: &str = "f640_640";
const MAX_PHOTOS: usize = 12;

/// Redirects are followed by hand, so every request stays on a Naver host.
static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    Client::builder()
        .user_agent(UA)
        .redirect(Policy::none())
        .timeout(Duration::from_secs(6))
        .build()
        .inspect_err(|e| tracing::warn!("naver: no http client: {e}"))
        .ok()
});

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Photo {
    /// Resized copy, ready for an <img>.
    pub url: String,
    /// Where it came from, e.g. "메뉴 · 간짜장" or "방문자 사진 · 비빔냉면".
    pub label: String,
}

/// Links this module can read: naver.me short links and *.naver.com pages.
pub fn is_naver(link: &str) -> bool {
    Url::parse(link)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|h| h == "naver.me" || h == "naver.com" || h.ends_with(".naver.com"))
}

/// What a place page tells us.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Place {
    /// Food photos, best first.
    pub photos: Vec<Photo>,
    /// (latitude, longitude)
    pub at: Option<(f64, f64)>,
    /// The place's own name, e.g. "홍명".
    pub name: Option<String>,
    /// What it is, e.g. "중식당".
    pub category: Option<String>,
    /// Its neighbourhood, e.g. "논현동".
    pub area: Option<String>,
}

impl Place {
    /// The photo a new candidate starts with, or "".
    pub fn first_photo(&self) -> String {
        self.photos
            .first()
            .map(|p| p.url.clone())
            .unwrap_or_default()
    }
}

/// The place behind a Naver Map link. Empty for any other link, or when the page can't be read.
pub async fn place(link: &str) -> Place {
    if !is_naver(link) {
        return Place::default();
    }
    fetch(link).await.unwrap_or_else(|e| {
        tracing::warn!("naver place for {link}: {e:#}");
        Place::default()
    })
}

async fn fetch(link: &str) -> anyhow::Result<Place> {
    let client = CLIENT.as_ref().context("http client unavailable")?;
    let id = match place_id(link) {
        Some(id) => id,
        // naver.me short links redirect to map.naver.com/p/entry/place/{id}
        None => {
            let res = client.get(link).send().await?;
            let to = location(&res);
            place_id(to).with_context(|| format!("no place id in {to:?}"))?
        }
    };
    // /place/{id}/home redirects to the place's category (restaurant, cafe, …)
    let mut url = Url::parse(&format!("https://m.place.naver.com/place/{id}/home"))?;
    for _ in 0..3 {
        let res = client.get(url.clone()).send().await?;
        if res.status().is_redirection() {
            let next = url.join(location(&res))?;
            anyhow::ensure!(
                next.host_str() == Some("m.place.naver.com"),
                "unexpected redirect to {next}"
            );
            url = next;
            continue;
        }
        anyhow::ensure!(
            res.status() == StatusCode::OK,
            "place page: {}",
            res.status()
        );
        return Ok(parse(&res.text().await?));
    }
    anyhow::bail!("too many redirects")
}

fn location(res: &reqwest::Response) -> &str {
    res.headers()
        .get(LOCATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
}

/// Numeric place id from map.naver.com/p/entry/place/{id}, m.place.naver.com/{kind}/{id}/…,
/// or an app link's ?pinId= / ?id=.
fn place_id(link: &str) -> Option<String> {
    let url = Url::parse(link).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    if !(host == "naver.com" || host.ends_with(".naver.com")) {
        return None;
    }
    let is_id = |s: &str| !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit());
    let segs: Vec<&str> = url
        .path_segments()
        .map(Iterator::collect)
        .unwrap_or_default();
    if let Some(w) = segs.windows(2).find(|w| w[0] == "place" && is_id(w[1])) {
        return Some(w[1].to_owned());
    }
    if host.ends_with("place.naver.com")
        && let Some(s) = segs.get(1).filter(|s| is_id(s))
    {
        return Some((*s).to_owned());
    }
    url.query_pairs()
        .find(|(k, v)| (k == "pinId" || k == "id") && is_id(v))
        .map(|(_, v)| v.into_owned())
}

/// Photos found in a place page: menu photos, then visitors' food photos, then the place's
/// own top photos; the og:image when the embedded data is missing. Plus its coordinates.
fn parse(html: &str) -> Place {
    let mut found = Found::default();
    let mut at = None;
    let (mut name, mut category, mut area) = (None, None, None);
    if let Some(Value::Object(state)) = embedded_state(html) {
        at = entries(&state, "PlaceDetailBase:").find_map(|v| coordinate(&v["coordinate"]));
        if let Some(base) = entries(&state, "PlaceDetailBase:").find(|v| v["name"].is_string()) {
            let text = |k: &str| {
                base[k]
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
            };
            name = text("name");
            category = text("category");
            area = text("address")
                .as_deref()
                .and_then(neighbourhood)
                .or_else(|| text("roadAddress").as_deref().and_then(neighbourhood));
        }
        for menu in entries(&state, "PlaceMenuItem:") {
            if let Some(src) = menu["images"][0]["url"].as_str() {
                let name = menu["name"].as_str().unwrap_or_default().trim();
                let label = if name.is_empty() {
                    "메뉴".into()
                } else {
                    format!("메뉴 · {name}")
                };
                found.push(src, label);
            }
        }
        let top: Vec<&Value> = entries(&state, "PlaceDetailTopPhotoItem:")
            .filter(|v| v["mediaFormat"] == "image")
            .collect();
        for v in &top {
            let tag = v["subFilterId"].as_str().unwrap_or_default();
            let what = if tag == "FOOD" {
                Some("음식")
            } else {
                tag.strip_prefix("MENU_NAME:")
            };
            if let (Some(what), Some(src)) = (what, v["originalUrl"].as_str()) {
                found.push(src, format!("방문자 사진 · {}", what.trim()));
            }
        }
        for v in &top {
            let own = v["id"].as_str().is_some_and(|id| id.contains("_business_"));
            if let (true, Some(src)) = (own, v["originalUrl"].as_str()) {
                found.push(src, "대표 사진".into());
            }
        }
    }
    if found.0.is_empty()
        && let Some(src) = og_image(html)
    {
        found.push(&src, "대표 사진".into());
    }
    Place {
        photos: found.0,
        at,
        name,
        category,
        area,
    }
}

/// "서울 강남구 논현동 37-9" → "논현동" ("…1가" too); a road address gives its district ("강남구").
fn neighbourhood(address: &str) -> Option<String> {
    let words: Vec<&str> = address.split_whitespace().collect();
    words
        .iter()
        .find(|w| {
            ['동', '읍', '면', '리'].iter().any(|e| w.ends_with(*e))
                // "종로1가", "태평로1가"
                || (w.ends_with('가') && w.chars().any(|c| c.is_ascii_digit()))
        })
        .or_else(|| {
            words
                .iter()
                .find(|w| w.ends_with('구') || w.ends_with('군') || w.ends_with('시'))
        })
        .map(|w| (*w).to_owned())
}

/// `{"x": "127.03", "y": "37.51"}` (strings or numbers) → (lat, lng), if plausible.
fn coordinate(c: &Value) -> Option<(f64, f64)> {
    let num = |v: &Value| v.as_f64().or_else(|| v.as_str()?.trim().parse().ok());
    let (lng, lat) = (num(&c["x"])?, num(&c["y"])?);
    ((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lng) && (lat, lng) != (0.0, 0.0))
        .then_some((lat, lng))
}

#[derive(Default)]
struct Found(Vec<Photo>);

impl Found {
    fn push(&mut self, src: &str, label: String) {
        if self.0.len() < MAX_PHOTOS
            && let Some(url) = resized(src)
            && !self.0.iter().any(|p| p.url == url)
        {
            self.0.push(Photo { url, label });
        }
    }
}

/// `window.__APOLLO_STATE__ = {…};` — read exactly one JSON value after the marker.
fn embedded_state(html: &str) -> Option<Value> {
    let rest = &html[html.find("__APOLLO_STATE__")?..];
    let json = &rest[rest.find('{')?..];
    serde_json::Deserializer::from_str(json)
        .into_iter::<Value>()
        .next()?
        .ok()
}

fn entries<'a>(state: &'a Map<String, Value>, prefix: &'a str) -> impl Iterator<Item = &'a Value> {
    state
        .iter()
        .filter(move |(k, _)| k.starts_with(prefix))
        .map(|(_, v)| v)
}

fn og_image(html: &str) -> Option<String> {
    let at = html.find("property=\"og:image\"")?;
    let tag = &html[at..at + html[at..].find('>')?];
    let start = tag.find("content=\"")? + "content=\"".len();
    let end = start + tag[start..].find('"')?;
    Some(tag[start..end].replace("&amp;", "&"))
}

/// Naver's resizer URL for a photo on Naver's image hosts; None for anything else.
fn resized(src: &str) -> Option<String> {
    let url = Url::parse(src).ok()?;
    let host = url.host_str()?;
    if !host.ends_with(".pstatic.net") {
        return None;
    }
    // already a resized copy (og:image): resize its original instead
    let original = if host == "search.pstatic.net" {
        url.query_pairs().find(|(k, _)| k == "src")?.1.into_owned()
    } else {
        src.to_owned()
    };
    Url::parse_with_params(
        "https://search.pstatic.net/common/",
        &[("type", SIZE), ("src", original.as_str())],
    )
    .ok()
    .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_naver_links() {
        assert!(is_naver("https://naver.me/AbCd1234"));
        assert!(is_naver("https://map.naver.com/p/entry/place/12345678"));
        assert!(!is_naver("https://map.kakao.com/?q=x"));
        assert!(!is_naver("https://naver.me.example.com/x"));
        assert!(!is_naver("not a url"));
    }

    #[test]
    fn finds_place_ids() {
        let id = |s| place_id(s);
        assert_eq!(
            id("https://map.naver.com/p/entry/place/12345678?placePath=%2Fhome").as_deref(),
            Some("12345678")
        );
        assert_eq!(
            id("https://m.place.naver.com/restaurant/23456789/home").as_deref(),
            Some("23456789")
        );
        assert_eq!(
            id("https://m.map.naver.com/appLink.naver?pinId=34567890&pinType=site").as_deref(),
            Some("34567890")
        );
        assert_eq!(
            id("https://naver.me/AbCd1234"),
            None,
            "short links need a request"
        );
        assert_eq!(id("https://example.com/place/123"), None);
    }

    #[test]
    fn names_the_neighbourhood() {
        assert_eq!(
            neighbourhood("서울 강남구 논현동 37-9").as_deref(),
            Some("논현동")
        );
        assert_eq!(
            neighbourhood("서울 강남구 논현로131길 10").as_deref(),
            Some("강남구")
        );
        assert_eq!(
            neighbourhood("경기 가평군 청평면 대성리 1").as_deref(),
            Some("청평면")
        );
        assert_eq!(
            neighbourhood("제주특별자치도 제주시 1"),
            Some("제주시".to_owned())
        );
        assert_eq!(neighbourhood(""), None);
    }

    #[test]
    fn lists_menu_then_visitor_food_then_own_photos() {
        let html = r#"<html><script>window.__APOLLO_STATE__ = {
            "PlaceDetailBase:1": {"name": "가게", "category": "중식당", "address": "서울 중구 태평로1가 31", "coordinate": {"x": "126.9779692", "y": "37.5662952"}},
            "PlaceMenuItem:a": {"name": "간짜장", "images": [{"url": "https://ldb-phinf.pstatic.net/a.jpg"}]},
            "PlaceMenuItem:b": {"name": "짬뽕", "images": []},
            "PlaceDetailTopPhotoItem:1_business_1": {"id": "1_business_1", "mediaFormat": "image", "subFilterId": null, "originalUrl": "https://pup-review-phinf.pstatic.net/b.jpg"},
            "PlaceDetailTopPhotoItem:1_clip_1": {"id": "1_clip_1", "mediaFormat": "video", "originalUrl": "https://clip-service-phinf.pstatic.net/c.jpg"},
            "PlaceDetailTopPhotoItem:1_visitor_1": {"id": "1_visitor_1", "mediaFormat": "image", "subFilterId": "INTERIOR", "originalUrl": "https://blogfiles.pstatic.net/d.jpg"},
            "PlaceDetailTopPhotoItem:1_visitor_2": {"id": "1_visitor_2", "mediaFormat": "image", "subFilterId": "MENU_NAME:비빔냉면", "originalUrl": "https://blogfiles.pstatic.net/e.jpg"},
            "PlaceDetailTopPhotoItem:1_visitor_3": {"id": "1_visitor_3", "mediaFormat": "image", "subFilterId": "FOOD", "originalUrl": "https://evil.example.com/f.jpg"},
            "PlaceDetailTopPhotoItem:1_visitor_4": {"id": "1_visitor_4", "mediaFormat": "image", "subFilterId": "FOOD", "originalUrl": "https://ldb-phinf.pstatic.net/a.jpg"}
        };</script></html>"#;
        let got = parse(html);
        assert_eq!(got.at, Some((37.5662952, 126.9779692)));
        assert_eq!(got.name.as_deref(), Some("가게"));
        assert_eq!(got.category.as_deref(), Some("중식당"));
        assert_eq!(got.area.as_deref(), Some("태평로1가"));
        let got = got.photos;
        let labels: Vec<&str> = got.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(
            labels,
            ["메뉴 · 간짜장", "방문자 사진 · 비빔냉면", "대표 사진"]
        );
        assert_eq!(
            got[0].url,
            "https://search.pstatic.net/common/?type=f640_640&src=https%3A%2F%2Fldb-phinf.pstatic.net%2Fa.jpg"
        );
    }

    #[test]
    fn falls_back_to_og_image() {
        let html = r#"<meta property="og:image" content="https://search.pstatic.net/common/?type=f640_380&amp;src=https%3A%2F%2Fldb-phinf.pstatic.net%2Fz.jpg"/>"#;
        let got = parse(html);
        assert_eq!(got.at, None);
        let got = got.photos;
        assert_eq!(got.len(), 1);
        assert_eq!(
            got[0].url,
            "https://search.pstatic.net/common/?type=f640_640&src=https%3A%2F%2Fldb-phinf.pstatic.net%2Fz.jpg"
        );
        assert_eq!(parse("<html></html>"), Place::default());
    }
}
