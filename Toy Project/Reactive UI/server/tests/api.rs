//! End-to-end API checks against an in-memory database.

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use reactive_ui_server::{AppState, archive::Archive, open_database, router};
use serde_json::{Value, json};
use tower::ServiceExt;

const KEY: &str = "test-key";
const BIRTHDAY: &str = "123456";
const HOME: &str = "203.0.113.7";

async fn app(key: Option<&str>) -> Router {
    let db = open_database("sqlite::memory:").await.unwrap();
    router(
        AppState {
            db,
            revision: "test".into(),
            planner_key: key.map(Into::into),
            naver_map_client_id: Some("test-map-id".into()),
            archive: key.and_then(|k| Archive::new(BIRTHDAY, k)).map(Into::into),
        },
        None,
    )
}

async fn call(
    app: &Router,
    method: Method,
    path: &str,
    body: Option<Value>,
    key: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(path);
    if let Some(k) = key {
        req = req.header("x-planner-key", k);
    }
    let req = match body {
        Some(b) => req
            .header("content-type", "application/json")
            .body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn plan(app: &Router, method: Method, path: &str, body: Option<Value>) -> Value {
    let (s, v) = call(app, method, &format!("/api/plan{path}"), body, Some(KEY)).await;
    assert!(s.is_success(), "{path} -> {s}: {v}");
    v
}

/// Course with two steps (lunch: world cup, cafe: roulette), three candidates each.
async fn seeded(app: &Router) -> Value {
    let mut c = plan(
        app,
        Method::POST,
        "/courses",
        Some(json!({ "title": "크리스마스", "date": "2026-12-24" })),
    )
    .await;
    // keep the first two template steps
    while c["steps"].as_array().unwrap().len() > 2 {
        let id = c["steps"][2]["id"].as_str().unwrap().to_string();
        c = plan(app, Method::DELETE, &format!("/steps/{id}"), None).await;
    }
    for i in 0..2 {
        let sid = c["steps"][i]["id"].as_str().unwrap().to_string();
        for n in 1..=3 {
            c = plan(app, Method::POST, &format!("/steps/{sid}/candidates"), Some(json!({ "name": format!("장소{i}-{n}"), "map_url": "https://map.kakao.com/?q=x" }))).await;
        }
    }
    c
}

#[tokio::test]
async fn planner_requires_key() {
    let closed = app(None).await;
    let (s, _) = call(&closed, Method::GET, "/api/plan/courses", None, Some(KEY)).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "no key configured -> closed");

    let app = app(Some(KEY)).await;
    let (s, _) = call(&app, Method::GET, "/api/plan/courses", None, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = call(&app, Method::GET, "/api/plan/courses", None, Some("wrong")).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, v) = call(&app, Method::GET, "/api/plan/courses", None, Some(KEY)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!([]));
}

#[tokio::test]
async fn new_course_gets_template_and_validates_input() {
    let app = app(Some(KEY)).await;
    let c = plan(
        &app,
        Method::POST,
        "/courses",
        Some(json!({ "title": "첫 데이트", "date": "2026-12-24" })),
    )
    .await;
    let labels: Vec<&str> = c["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, ["식당", "카페", "활동", "저녁"]);
    assert_eq!(c["status"], "draft");
    let sid = c["steps"][0]["id"].as_str().unwrap();
    for game in [
        "worldcup", "swipe", "flip", "roulette", "slot", "ladder", "gacha", "balance",
    ] {
        let s = plan(
            &app,
            Method::PATCH,
            &format!("/steps/{sid}"),
            Some(json!({ "game": game })),
        )
        .await;
        assert_eq!(s["steps"][0]["game"], game);
    }

    let (s, v) = call(
        &app,
        Method::POST,
        "/api/plan/courses",
        Some(json!({ "title": "x", "date": "2026-13-01" })),
        Some(KEY),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    let sid = c["steps"][0]["id"].as_str().unwrap();
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/plan/steps/{sid}/candidates"),
        Some(json!({ "name": "a", "map_url": "javascript:alert(1)" })),
        Some(KEY),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::BAD_REQUEST,
        "non-http map links are rejected"
    );
    let (s, _) = call(
        &app,
        Method::PATCH,
        &format!("/api/plan/steps/{sid}"),
        Some(json!({ "game": "bingo" })),
        Some(KEY),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "unknown games are rejected");
}

#[tokio::test]
async fn cannot_open_until_every_step_has_two_candidates() {
    let app = app(Some(KEY)).await;
    let c = plan(
        &app,
        Method::POST,
        "/courses",
        Some(json!({ "title": "t", "date": "2026-12-24" })),
    )
    .await;
    let id = c["id"].as_str().unwrap();
    let (s, v) = call(
        &app,
        Method::PATCH,
        &format!("/api/plan/courses/{id}"),
        Some(json!({ "status": "open" })),
        Some(KEY),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(v["error"].as_str().unwrap().contains("식당"));
}

#[tokio::test]
async fn picker_sees_one_step_at_a_time_and_completes() {
    let app = app(Some(KEY)).await;
    let c = seeded(&app).await;
    let (id, code) = (c["id"].as_str().unwrap(), c["share_code"].as_str().unwrap());
    let (s0, s1) = (
        c["steps"][0]["id"].as_str().unwrap(),
        c["steps"][1]["id"].as_str().unwrap(),
    );

    // draft: link shows nothing yet
    let (s, v) = call(&app, Method::GET, &format!("/api/pick/{code}"), None, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["status"], "draft");
    assert!(v["current"].is_null() && v["steps"].as_array().unwrap().is_empty());

    plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    let (_, v) = call(&app, Method::GET, &format!("/api/pick/{code}"), None, None).await;
    assert_eq!(v["current"]["id"], s0);
    assert_eq!(v["current"]["candidates"].as_array().unwrap().len(), 3);
    assert_eq!(v["steps"][1]["state"], "locked");
    let body = v.to_string();
    assert!(
        !body.contains("장소1-"),
        "later candidates must not be sent: {body}"
    );

    // out of order / wrong candidate
    let other = c["steps"][1]["candidates"][0]["id"].as_str().unwrap();
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s1}/pick"),
        Some(json!({ "candidate_id": other })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s0}/pick"),
        Some(json!({ "candidate_id": other })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // world cup has no rerolls
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s0}/reroll"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    let first = c["steps"][0]["candidates"][1]["id"].as_str().unwrap();
    let (s, v) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s0}/pick"),
        Some(json!({ "candidate_id": first })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["steps"][0]["state"], "done");
    assert_eq!(v["steps"][0]["picked"]["name"], "장소0-2");
    assert_eq!(v["current"]["id"], s1);
    assert_eq!(v["current"]["game"], "roulette");
    assert_eq!(v["current"]["rerolls_left"], 1);

    // roulette: one reroll, then none
    let (s, v) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s1}/reroll"),
        None,
        None,
    )
    .await;
    assert_eq!((s, v["rerolls_left"].as_i64()), (StatusCode::OK, Some(0)));
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s1}/reroll"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    let last = c["steps"][1]["candidates"][2]["id"].as_str().unwrap();
    let (_, v) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s1}/pick"),
        Some(json!({ "candidate_id": last })),
        None,
    )
    .await;
    assert_eq!(v["status"], "done");
    assert!(v["current"].is_null());

    // planner can reset; history recorded both sides
    let c = plan(&app, Method::POST, &format!("/courses/{id}/reset"), None).await;
    assert_eq!(c["status"], "open");
    let h = plan(&app, Method::GET, &format!("/courses/{id}/history"), None).await;
    let actions: Vec<&str> = h
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["action"].as_str().unwrap())
        .collect();
    assert!(
        actions.contains(&"pick")
            && actions.contains(&"reroll")
            && actions.contains(&"course.reset")
    );
}

#[tokio::test]
async fn unknown_links_are_not_found() {
    let app = app(Some(KEY)).await;
    let (s, _) = call(&app, Method::GET, "/api/pick/nope", None, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = call(&app, Method::GET, "/api/nothing", None, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn candidate_photos_are_stored_shown_and_cleared() {
    let app = app(Some(KEY)).await;
    let c = seeded(&app).await;
    let cand = c["steps"][0]["candidates"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let photo = "https://search.pstatic.net/common/?type=f640_640&src=https%3A%2F%2Fldb-phinf.pstatic.net%2Fa.jpg";

    let (s, _) = call(
        &app,
        Method::PATCH,
        &format!("/api/plan/candidates/{cand}"),
        Some(json!({ "image_url": "javascript:alert(1)" })),
        Some(KEY),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "only https photo links");

    let c = plan(
        &app,
        Method::PATCH,
        &format!("/candidates/{cand}"),
        Some(json!({ "image_url": photo })),
    )
    .await;
    assert_eq!(c["steps"][0]["candidates"][0]["image_url"], photo);
    // editing other fields keeps the photo
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/candidates/{cand}"),
        Some(json!({ "memo": "창가" })),
    )
    .await;
    assert_eq!(c["steps"][0]["candidates"][0]["image_url"], photo);

    // the picker gets it with the candidate
    let id = c["id"].as_str().unwrap();
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    let code = c["share_code"].as_str().unwrap();
    let (_, v) = call(&app, Method::GET, &format!("/api/pick/{code}"), None, None).await;
    assert_eq!(v["current"]["candidates"][0]["image_url"], photo);

    // a different place drops the old photo (a non-Naver link has none to offer)
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/candidates/{cand}"),
        Some(json!({ "map_url": "https://map.kakao.com/?q=y" })),
    )
    .await;
    assert_eq!(c["steps"][0]["candidates"][0]["image_url"], "");
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/candidates/{cand}"),
        Some(json!({ "image_url": photo })),
    )
    .await;
    assert_eq!(c["steps"][0]["candidates"][0]["image_url"], photo);
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/candidates/{cand}"),
        Some(json!({ "image_url": "" })),
    )
    .await;
    assert_eq!(
        c["steps"][0]["candidates"][0]["image_url"], "",
        "empty removes it"
    );

    let v = plan(
        &app,
        Method::GET,
        &format!("/candidates/{cand}/photos"),
        None,
    )
    .await;
    assert_eq!(v, json!([]), "no Naver link, nothing to choose from");
}

#[tokio::test]
async fn config_and_locations_reach_the_picker() {
    let app = app(Some(KEY)).await;
    let (s, v) = call(&app, Method::GET, "/api/config", None, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["naver_map_client_id"], "test-map-id");

    // non-Naver links have no location to read
    let c = seeded(&app).await;
    let cand = &c["steps"][0]["candidates"][0];
    assert!(cand["lat"].is_null() && cand["lng"].is_null());
    let id = c["id"].as_str().unwrap();
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    let code = c["share_code"].as_str().unwrap();
    let (_, v) = call(&app, Method::GET, &format!("/api/pick/{code}"), None, None).await;
    let first = &v["current"]["candidates"][0];
    assert!(first.get("lat").is_some() && first["lat"].is_null());
}

/// Archive request from an address, with an optional cookie; returns status, Set-Cookie and body.
async fn archive_call(
    app: &Router,
    from: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
    cookie: Option<&str>,
) -> (StatusCode, Option<String>, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("cf-connecting-ip", from);
    if let Some(c) = cookie {
        req = req.header("cookie", c);
    }
    let req = match body {
        Some(b) => req
            .header("content-type", "application/json")
            .body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let set = res
        .headers()
        .get("set-cookie")
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        set,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn archive_opens_with_the_birthday_and_lists_shared_courses() {
    let closed = app(None).await;
    let (_, v) = call(&closed, Method::GET, "/api/config", None, None).await;
    assert!(v["archive_digits"].is_null());
    let (s, _, _) = archive_call(&closed, HOME, Method::GET, "/api/archive", None, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "no passcode configured -> closed");

    let app = app(Some(KEY)).await;
    let (_, v) = call(&app, Method::GET, "/api/config", None, None).await;
    assert_eq!(v["archive_digits"], 6);

    // one draft (hidden), one shared and finished
    let c = seeded(&app).await;
    let draft = seeded(&app).await;
    let id = c["id"].as_str().unwrap();
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    let code = c["share_code"].as_str().unwrap();
    for i in 0..2 {
        let (sid, cid) = (
            c["steps"][i]["id"].as_str().unwrap(),
            c["steps"][i]["candidates"][1]["id"].as_str().unwrap(),
        );
        let (s, _) = call(
            &app,
            Method::POST,
            &format!("/api/pick/{code}/steps/{sid}/pick"),
            Some(json!({ "candidate_id": cid })),
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
    }

    let (s, _, _) = archive_call(&app, HOME, Method::GET, "/api/archive", None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::GET,
        "/api/archive",
        None,
        Some("archive=forged"),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    // (a miss makes its address wait, so it comes from elsewhere)
    let (s, set, _) = archive_call(
        &app,
        "198.51.100.200",
        Method::POST,
        "/api/archive/unlock",
        Some(json!({ "code": "000000" })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(set.is_none());

    // separators are ignored
    let (s, set, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/archive/unlock",
        Some(json!({ "code": "12 34 56" })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let set = set.unwrap();
    assert!(
        set.contains("HttpOnly") && set.contains("Path=/api/archive"),
        "{set}"
    );
    let cookie = set.split(';').next().unwrap().to_string();

    let (s, _, v) =
        archive_call(&app, HOME, Method::GET, "/api/archive", None, Some(&cookie)).await;
    assert_eq!(s, StatusCode::OK);
    let list = v.as_array().unwrap();
    assert_eq!(list.len(), 1, "drafts stay hidden: {v}");
    assert_eq!(list[0]["share_code"], code);
    assert_eq!(list[0]["status"], "done");
    assert_eq!(list[0]["stops"][0]["name"], "장소0-2");
    assert_eq!(list[0]["stops"][1]["name"], "장소1-2");
    assert!(
        !v.to_string()
            .contains(draft["share_code"].as_str().unwrap())
    );

    // locking clears the cookie
    let (s, set, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/archive/lock",
        None,
        Some(&cookie),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(set.unwrap().contains("Max-Age=0"));

    let (_, v) = call(&app, Method::GET, "/api/config", None, None).await;
    assert!(
        v["turnstile_site_key"].is_null(),
        "no bot check configured in tests"
    );
}

async fn unlock_as(app: &Router, from: &str, code: &str) -> (StatusCode, Value) {
    let (s, _, v) = archive_call(
        app,
        from,
        Method::POST,
        "/api/archive/unlock",
        Some(json!({ "code": code })),
        None,
    )
    .await;
    (s, v)
}

#[tokio::test]
async fn archive_guesses_wait_then_lock_until_the_planner_reopens() {
    let app = app(Some(KEY)).await;
    let (s, _) = call(&app, Method::GET, "/api/plan/archive", None, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "the guard is planner-only");

    // the first miss costs a minute, and then even the right code has to wait
    let (s, v) = unlock_as(&app, HOME, "999999").await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert!(v["error"].as_str().unwrap().contains("1분"), "{v}");
    assert_eq!(v["retry_after"], 60);
    let (s, v) = unlock_as(&app, HOME, BIRTHDAY).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS, "{v}");
    assert!(
        v["retry_after"].as_i64().is_some_and(|t| t > 0 && t <= 60),
        "{v}"
    );

    // another address is not held up, and a success there resets nothing here
    let (s, _) = unlock_as(&app, "192.0.2.10", BIRTHDAY).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = unlock_as(&app, HOME, BIRTHDAY).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);

    let g = plan(&app, Method::GET, "/archive", None).await;
    assert_eq!(g["enabled"], true);
    assert_eq!(g["misses_today"], 1);
    assert_eq!(g["daily_limit"], 20);
    assert!(g["locked_at"].is_null());
    assert_eq!(g["recent"][0]["ok"], true);
    assert_eq!(g["recent"][0]["address"], "192.0.2.*");
    assert_eq!(g["recent"][1]["ok"], false);

    // misses from everywhere add up to the daily limit, which locks the archive for everyone
    let mut locked = false;
    for n in 0..30 {
        let (s, v) = unlock_as(&app, &format!("198.51.100.{n}"), "999999").await;
        if s == StatusCode::TOO_MANY_REQUESTS {
            assert!(v["error"].as_str().unwrap().contains("잠가"), "{v}");
            locked = true;
            break;
        }
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    }
    assert!(locked);
    let g = plan(&app, Method::GET, "/archive", None).await;
    assert!(g["locked_at"].is_i64(), "{g}");
    assert_eq!(g["misses_today"], 20);
    let (s, _) = unlock_as(&app, "192.0.2.99", BIRTHDAY).await;
    assert_eq!(
        s,
        StatusCode::TOO_MANY_REQUESTS,
        "locked even for the right code"
    );

    // the planner reopens it and forgives the misses so far
    let g = plan(&app, Method::POST, "/archive/reopen", None).await;
    assert!(g["locked_at"].is_null());
    assert_eq!(g["misses_today"], 0);
    let (s, _) = unlock_as(&app, HOME, BIRTHDAY).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn weather_far_ahead_needs_no_request() {
    let app = app(Some(KEY)).await;
    let c = plan(
        &app,
        Method::POST,
        "/courses",
        Some(json!({ "title": "먼 훗날", "date": "2099-12-24" })),
    )
    .await;
    let (id, code) = (c["id"].as_str().unwrap(), c["share_code"].as_str().unwrap());

    let (s, v) = call(
        &app,
        Method::GET,
        &format!("/api/pick/{code}/weather"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["status"], "far");
    assert!(v["days_until"].as_i64().unwrap() > 15);
    assert!(v["day"].is_null() && v["hours"].as_array().unwrap().is_empty());

    let v = plan(&app, Method::GET, &format!("/courses/{id}/weather"), None).await;
    assert_eq!(v["status"], "far");

    let (s, _) = call(&app, Method::GET, "/api/pick/nope/weather", None, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Raw request with a byte body and an optional cookie: status, headers, body bytes.
async fn raw(
    app: &Router,
    method: Method,
    path: &str,
    body: Vec<u8>,
    cookie: Option<&str>,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("cf-connecting-ip", HOME)
        .header("content-type", "image/jpeg");
    if let Some(c) = cookie {
        req = req.header("cookie", c);
    }
    let res = app
        .clone()
        .oneshot(req.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let (parts, body) = res.into_parts();
    let bytes = body.collect().await.unwrap().to_bytes().to_vec();
    (parts.status, parts.headers, bytes)
}

/// A phone-like JPEG: 2400×1800 with an EXIF block carrying a location.
fn phone_photo() -> Vec<u8> {
    use image::{DynamicImage, ImageBuffer, Rgb, codecs::jpeg::JpegEncoder};
    let img = ImageBuffer::from_fn(2400, 1800, |x, y| {
        Rgb([(x % 251) as u8, (y % 241) as u8, 120])
    });
    let mut jpg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpg, 85)
        .encode_image(&DynamicImage::ImageRgb8(img))
        .unwrap();
    let payload = b"Exif\0\0MM\0*GPS 37.5665 N 126.9780 E";
    let mut out = jpg[..2].to_vec();
    out.extend([0xFF, 0xE1]);
    out.extend(((payload.len() + 2) as u16).to_be_bytes());
    out.extend(payload);
    out.extend(&jpg[2..]);
    out
}

#[tokio::test]
async fn album_keeps_clean_photos_for_the_signed_in() {
    let app = app(Some(KEY)).await;
    let c = seeded(&app).await;
    let draft = seeded(&app).await;
    let id = c["id"].as_str().unwrap();
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    let code = c["share_code"].as_str().unwrap();
    let step = c["steps"][0]["id"].as_str().unwrap();
    let other_step = draft["steps"][0]["id"].as_str().unwrap();
    let photos = format!("/api/archive/courses/{code}/photos");

    let (s, _, _) = raw(&app, Method::POST, &photos, phone_photo(), None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "the birthday comes first");

    let (s, set, _) = archive_call(
        &app,
        "192.0.2.50",
        Method::POST,
        "/api/archive/unlock",
        Some(json!({ "code": BIRTHDAY })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let cookie = set.unwrap().split(';').next().unwrap().to_string();
    let ck = Some(cookie.as_str());

    let dc = draft["share_code"].as_str().unwrap();
    let (s, _, _) = raw(
        &app,
        Method::POST,
        &format!("/api/archive/courses/{dc}/photos"),
        phone_photo(),
        ck,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "drafts have no album");

    let (s, _, body) = raw(&app, Method::POST, &photos, phone_photo(), ck).await;
    assert_eq!(s, StatusCode::CREATED, "{}", String::from_utf8_lossy(&body));
    let day: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        (day["width"].as_i64(), day["height"].as_i64()),
        (Some(1600), Some(1200))
    );
    assert!(day["step_id"].is_null());

    let (s, _, body) = raw(
        &app,
        Method::POST,
        &format!("{photos}?step={step}"),
        phone_photo(),
        ck,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let at_stop: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(at_stop["step_id"], step);

    let (s, _, _) = raw(
        &app,
        Method::POST,
        &format!("{photos}?step={other_step}"),
        phone_photo(),
        ck,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "another course's stop");
    let (s, _, _) = raw(&app, Method::POST, &photos, b"not a photo".to_vec(), ck).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (s, _, body) = raw(&app, Method::GET, &photos, vec![], ck).await;
    assert_eq!(s, StatusCode::OK);
    let list: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 2);

    // served clean, privately, only to the signed-in
    let pid = day["id"].as_str().unwrap();
    for path in [
        format!("/api/archive/photos/{pid}"),
        format!("/api/archive/photos/{pid}/thumb"),
    ] {
        let (s, h, bytes) = raw(&app, Method::GET, &path, vec![], ck).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(h["content-type"], "image/jpeg");
        assert!(h["cache-control"].to_str().unwrap().starts_with("private"));
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
        assert!(
            !bytes.windows(3).any(|w| w == b"GPS"),
            "location must not survive"
        );
        let (s, _, _) = raw(&app, Method::GET, &path, vec![], None).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }

    // the archive card shows our photos
    let (_, _, v) = archive_call(&app, HOME, Method::GET, "/api/archive", None, ck).await;
    let card = v
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["share_code"] == code)
        .unwrap()
        .clone();
    assert_eq!(card["photos"][0], pid);

    // deleting is for good
    let (s, _, _) = raw(
        &app,
        Method::DELETE,
        &format!("/api/archive/photos/{pid}"),
        vec![],
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _, _) = raw(
        &app,
        Method::DELETE,
        &format!("/api/archive/photos/{pid}"),
        vec![],
        ck,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _, _) = raw(
        &app,
        Method::GET,
        &format!("/api/archive/photos/{pid}"),
        vec![],
        ck,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (_, _, body) = raw(&app, Method::GET, &photos, vec![], ck).await;
    assert_eq!(
        serde_json::from_slice::<Value>(&body)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
