//! Input checks shared by the planner and picker handlers.

use crate::error::{Result, bad};

/// Games the web app can play; keep in step with `web/src/games/index.ts`.
pub const GAMES: &[&str] = &[
    "worldcup",
    "swipe",
    "flip",
    "roulette",
    "slot",
    "ladder",
    "gacha",
    "balance",
    "blind",
    "hearts",
    "eliminate",
    "rank",
    "scratch",
    "gift",
    "plinko",
    "race",
    "dart",
    "lots",
    "crane",
];
/// Games that end on chance and therefore offer "try again".
pub const LUCK_GAMES: &[&str] = &[
    "flip", "roulette", "slot", "ladder", "gacha", "balance", "scratch", "gift", "plinko", "race",
    "dart", "lots", "crane",
];
/// Step icons; keep in step with `KIND_LABEL` in `web/src/lib/look.ts`.
pub const KINDS: &[&str] = &[
    "meal", "cafe", "dinner", "drink", "walk", "play", "shop", "photo", "drive", "arcade", "stay",
    "movie", "show", "exhibit", "home",
];

/// The Korean name of an icon, as the web app shows it (for stops that have no label of their
/// own, like a place they dropped by).
pub fn kind_label(kind: &str) -> &'static str {
    match kind {
        "meal" => "식사",
        "cafe" => "카페",
        "dinner" => "저녁",
        "drink" => "술 한잔",
        "walk" => "산책",
        "shop" => "쇼핑",
        "photo" => "사진",
        "drive" => "드라이브",
        "arcade" => "오락",
        "stay" => "호캉스",
        "movie" => "영화",
        "show" => "공연",
        "exhibit" => "전시",
        "home" => "집 데이트",
        _ => "활동",
    }
}

/// What a step's candidates are: "place" (somewhere on the map, from a map link), "work" (a
/// movie, show or exhibition: one venue for the step, each candidate a title with a time) or
/// "free" (a date at home: just a name, a note and a picture).
pub fn form(kind: &str) -> &'static str {
    match kind {
        "movie" | "show" | "exhibit" => "work",
        "home" => "free",
        _ => "place",
    }
}

/// Running time in minutes, 1 to 600.
pub fn runtime(value: i64) -> Result<i64> {
    if (1..=600).contains(&value) {
        Ok(value)
    } else {
        Err(bad("러닝타임은 1~600분으로 적어 줘"))
    }
}

/// Empty, or an http(s) link without spaces: an info or booking page.
pub fn link(value: &str) -> Result<String> {
    map_url(value).map_err(|_| bad("링크는 https:// 로 시작하는 주소를 붙여 줘"))
}

pub fn text(value: &str, field: &str, max: usize) -> Result<String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(bad(format!("{field}을(를) 입력해 줘")));
    }
    if v.chars().count() > max {
        return Err(bad(format!("{field}은(는) {max}자 이내로 적어 줘")));
    }
    Ok(v.to_string())
}

pub fn optional_text(value: &str, field: &str, max: usize) -> Result<String> {
    let v = value.trim();
    if v.chars().count() > max {
        return Err(bad(format!("{field}은(는) {max}자 이내로 적어 줘")));
    }
    Ok(v.to_string())
}

/// YYYY-MM-DD with a plausible month/day.
pub fn date(value: &str) -> Result<String> {
    let v = value.trim();
    let ok = v.len() == 10
        && v.as_bytes()[4] == b'-'
        && v.as_bytes()[7] == b'-'
        && v.chars()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && (1..=12).contains(&v[5..7].parse::<u32>().unwrap_or(0))
        && (1..=31).contains(&v[8..10].parse::<u32>().unwrap_or(0));
    if ok {
        Ok(v.to_string())
    } else {
        Err(bad("날짜는 2026-12-24 형식으로 적어 줘"))
    }
}

/// HH:MM (24h) or empty.
pub fn time(value: &str) -> Result<String> {
    let v = value.trim();
    if v.is_empty() {
        return Ok(String::new());
    }
    let ok = v.len() == 5
        && v.as_bytes()[2] == b':'
        && v[0..2].parse::<u32>().is_ok_and(|h| h < 24)
        && v[3..5].parse::<u32>().is_ok_and(|m| m < 60);
    if ok {
        Ok(v.to_string())
    } else {
        Err(bad("시간은 14:30 형식으로 적어 줘"))
    }
}

/// Empty, or an http(s) link without spaces (blocks javascript: and friends).
pub fn map_url(value: &str) -> Result<String> {
    let v = value.trim();
    if v.is_empty() {
        return Ok(String::new());
    }
    let lower = v.to_ascii_lowercase();
    if (lower.starts_with("https://") || lower.starts_with("http://"))
        && v.len() <= 500
        && !v.chars().any(char::is_whitespace)
    {
        Ok(v.to_string())
    } else {
        Err(bad("지도 링크는 https:// 로 시작하는 주소를 붙여 줘"))
    }
}

pub fn one_of(value: &str, allowed: &[&str], field: &str) -> Result<String> {
    if allowed.contains(&value) {
        Ok(value.to_string())
    } else {
        Err(bad(format!("{field} 값이 올바르지 않아")))
    }
}

pub fn rerolls(value: i64) -> Result<i64> {
    if (0..=3).contains(&value) {
        Ok(value)
    } else {
        Err(bad("다시 하기는 0~3번으로 정해 줘"))
    }
}

/// Photo link: https only (the pages are https), no whitespace.
pub fn image_url(value: &str) -> Result<String> {
    let v = value.trim();
    if v.to_ascii_lowercase().starts_with("https://")
        && v.len() > "https://".len()
        && v.len() <= 800
        && !v.chars().any(char::is_whitespace)
    {
        Ok(v.to_string())
    } else {
        Err(bad("사진 링크는 https:// 로 시작하는 주소를 붙여 줘"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_have_a_form() {
        assert_eq!(form("movie"), "work");
        assert_eq!(form("exhibit"), "work");
        assert_eq!(form("home"), "free");
        assert_eq!(form("meal"), "place");
        assert!(
            KINDS
                .iter()
                .all(|k| ["place", "work", "free"].contains(&form(k)))
        );
        assert!(runtime(0).is_err() && runtime(137).is_ok() && runtime(601).is_err());
    }

    #[test]
    fn luck_games_are_games() {
        assert!(LUCK_GAMES.iter().all(|g| GAMES.contains(g)));
    }

    #[test]
    fn dates_and_times() {
        assert!(date("2026-12-24").is_ok());
        assert!(date("2026-13-01").is_err());
        assert!(date("26-12-24").is_err());
        assert_eq!(time("").unwrap(), "");
        assert!(time("09:05").is_ok());
        assert!(time("24:00").is_err());
    }

    #[test]
    fn map_links_must_be_http() {
        assert!(map_url("https://map.kakao.com/?q=x").is_ok());
        assert!(map_url("javascript:alert(1)").is_err());
        assert!(map_url("https://a b").is_err());
        assert_eq!(map_url("  ").unwrap(), "");
        assert!(image_url("https://search.pstatic.net/common/?type=f640_640").is_ok());
        assert!(image_url("http://x.com/a.jpg").is_err());
        assert!(image_url("javascript:alert(1)").is_err());
    }
}
