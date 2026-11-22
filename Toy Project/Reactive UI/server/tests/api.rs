//! End-to-end API checks against an in-memory database.

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use reactive_ui_server::{AppState, auth::Auth, open_database, router};
use serde_json::{Value, json};
use tower::ServiceExt;

const KEY: &str = "test-key";
const HOME: &str = "203.0.113.7";

async fn app(key: Option<&str>) -> Router {
    let db = open_database("sqlite::memory:").await.unwrap();
    router(
        AppState {
            db,
            revision: "test".into(),
            planner_key: key.map(Into::into),
            naver_map_client_id: Some("test-map-id".into()),
            auth: key.map(|_| Auth::new("http://localhost:8080").unwrap().into()),
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

fn session_of(set_cookie: &str) -> String {
    set_cookie.split(';').next().unwrap().to_string()
}

#[tokio::test]
async fn archive_opens_with_a_session_from_a_link() {
    let closed = app(None).await;
    let (_, v) = call(&closed, Method::GET, "/api/config", None, None).await;
    assert_eq!(v["auth"], false);
    let (s, _, _) = archive_call(&closed, HOME, Method::GET, "/api/archive", None, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "no origin configured -> closed");

    let app = app(Some(KEY)).await;
    let (_, v) = call(&app, Method::GET, "/api/config", None, None).await;
    assert_eq!(v["auth"], true);

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
        Some("session=forged"),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    // the planner makes a single-use link; the link alone opens a short session
    let (s, _) = call(
        &app,
        Method::POST,
        "/api/plan/invites",
        Some(json!({ "name": "지원" })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "links are planner-only");
    let made = plan(
        &app,
        Method::POST,
        "/invites",
        Some(json!({ "name": "지원" })),
    )
    .await;
    let token = made["token"].as_str().unwrap().to_string();
    assert_eq!(token.len(), 64);
    let (s, _, v) = archive_call(
        &app,
        HOME,
        Method::GET,
        &format!("/api/auth/invite/{token}"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["name"], "지원");

    let (s, set, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        &format!("/api/auth/invite/{token}/enter"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let set = set.unwrap();
    assert!(
        set.contains("HttpOnly") && set.contains("Path=/api") && set.contains("Secure"),
        "{set}"
    );
    let cookie = session_of(&set);

    let (s, _, v) =
        archive_call(&app, HOME, Method::GET, "/api/archive", None, Some(&cookie)).await;
    assert_eq!(s, StatusCode::OK);
    let list = v.as_array().unwrap();
    assert_eq!(list.len(), 1, "drafts stay hidden: {v}");
    assert_eq!(list[0]["share_code"], code);
    assert_eq!(list[0]["stops"][0]["name"], "장소0-2");
    assert!(
        !v.to_string()
            .contains(draft["share_code"].as_str().unwrap())
    );
    let (_, _, v) =
        archive_call(&app, HOME, Method::GET, "/api/auth/me", None, Some(&cookie)).await;
    assert_eq!(v["name"], "지원");

    // a link works once
    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        &format!("/api/auth/invite/{token}/enter"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::GET,
        &format!("/api/auth/invite/{token}"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let people = plan(&app, Method::GET, "/people", None).await;
    assert_eq!(people[0]["name"], "지원");
    assert_eq!(people[0]["sessions"], 1);
    assert_eq!(people[0]["devices"].as_array().unwrap().len(), 0);
    let person = people[0]["id"].as_str().unwrap().to_string();

    // logging out ends that session
    let (s, set, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/logout",
        None,
        Some(&cookie),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(set.unwrap().contains("Max-Age=0"));
    let (s, _, _) =
        archive_call(&app, HOME, Method::GET, "/api/archive", None, Some(&cookie)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    // the planner can sign a person out everywhere
    let made = plan(
        &app,
        Method::POST,
        "/invites",
        Some(json!({ "name": "지원" })),
    )
    .await;
    let t2 = made["token"].as_str().unwrap();
    assert_eq!(
        made["people"].as_array().unwrap().len(),
        1,
        "same name, same person"
    );
    let (_, set, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        &format!("/api/auth/invite/{t2}/enter"),
        None,
        None,
    )
    .await;
    let c2 = session_of(&set.unwrap());
    plan(
        &app,
        Method::DELETE,
        &format!("/people/{person}/sessions"),
        None,
    )
    .await;
    let (s, _, _) = archive_call(&app, HOME, Method::GET, "/api/archive", None, Some(&c2)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let people = plan(&app, Method::DELETE, &format!("/people/{person}"), None).await;
    assert!(people.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn passkey_ceremonies_start_for_a_live_link() {
    let app = app(Some(KEY)).await;
    let (s, _, v) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/signin/start",
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "nothing registered yet: {v}");

    let made = plan(
        &app,
        Method::POST,
        "/invites",
        Some(json!({ "name": "나" })),
    )
    .await;
    let token = made["token"].as_str().unwrap();
    let (s, _, v) = archive_call(
        &app,
        HOME,
        Method::POST,
        &format!("/api/auth/invite/{token}/register"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let pk = &v["options"]["publicKey"];
    assert_eq!(pk["rp"]["id"], "localhost");
    assert_eq!(pk["user"]["name"], "나");
    assert!(pk["challenge"].as_str().is_some_and(|c| !c.is_empty()));
    assert!(v["flow"].as_str().is_some());

    // finishing needs a real ceremony; unknown flows are refused
    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/register",
        Some(json!({ "flow": "nope", "credential": {
        "id": "AA", "rawId": "AA", "type": "public-key",
        "response": { "attestationObject": "AA", "clientDataJSON": "AA" }
    } })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/invite/not-a-token/register",
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
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

/// A whole passkey life with a software authenticator: register through a link, sign out, sign
/// back in, then lose the device.
#[tokio::test]
async fn passkeys_register_sign_in_and_can_be_removed() {
    use webauthn_authenticator_rs::{WebauthnAuthenticator, softpasskey::SoftPasskey};
    use webauthn_rs::prelude::{CreationChallengeResponse, RequestChallengeResponse, Url};

    let app = app(Some(KEY)).await;
    let origin = Url::parse("http://localhost:8080").unwrap();
    // "falsify UV": the soft token claims the Face ID step that real devices perform
    let mut device = SoftPasskey::new(true);

    let made = plan(
        &app,
        Method::POST,
        "/invites",
        Some(json!({ "name": "지원" })),
    )
    .await;
    let token = made["token"].as_str().unwrap();
    let (s, _, v) = archive_call(
        &app,
        HOME,
        Method::POST,
        &format!("/api/auth/invite/{token}/register"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let options: CreationChallengeResponse = serde_json::from_value(v["options"].clone()).unwrap();
    let credential = device.do_registration(origin.clone(), options).unwrap();
    let (s, set, v) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/register",
        Some(json!({ "flow": v["flow"], "credential": credential })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    let cookie = session_of(&set.unwrap());
    let (s, _, v) =
        archive_call(&app, HOME, Method::GET, "/api/auth/me", None, Some(&cookie)).await;
    assert_eq!((s, v["name"].as_str()), (StatusCode::OK, Some("지원")));

    // the link is spent by the registration
    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::GET,
        &format!("/api/auth/invite/{token}"),
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/logout",
        None,
        Some(&cookie),
    )
    .await;
    let sign_in = |device: &mut SoftPasskey, v: &Value| {
        let options: RequestChallengeResponse =
            serde_json::from_value(v["options"].clone()).unwrap();
        device.do_authentication(origin.clone(), options).unwrap()
    };
    let (s, _, v) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/signin/start",
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let assertion = sign_in(&mut device, &v);
    let (s, set, v) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/signin",
        Some(json!({ "flow": v["flow"], "credential": assertion })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    let cookie = session_of(&set.unwrap());
    let (s, _, _) =
        archive_call(&app, HOME, Method::GET, "/api/archive", None, Some(&cookie)).await;
    assert_eq!(s, StatusCode::OK);

    // a ceremony answers once
    let (_, _, v) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/signin/start",
        None,
        None,
    )
    .await;
    let assertion = sign_in(&mut device, &v);
    let body = json!({ "flow": v["flow"], "credential": assertion });
    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/signin",
        Some(body.clone()),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/signin",
        Some(body),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "replayed");

    // the planner sees the device and can forget it: its sessions end, it can't sign in
    let people = plan(&app, Method::GET, "/people", None).await;
    let devices = people[0]["devices"].as_array().unwrap();
    assert_eq!(devices.len(), 1);
    let id = devices[0]["id"].as_str().unwrap();
    plan(&app, Method::DELETE, &format!("/passkeys/{id}"), None).await;
    let (s, _, _) =
        archive_call(&app, HOME, Method::GET, "/api/archive", None, Some(&cookie)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/auth/signin/start",
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "no devices left");
}
