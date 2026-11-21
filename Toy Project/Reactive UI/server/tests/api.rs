//! End-to-end API checks against an in-memory database.

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use reactive_ui_server::{AppState, open_database, router};
use serde_json::{Value, json};
use tower::ServiceExt;

const KEY: &str = "test-key";

async fn app(key: Option<&str>) -> Router {
    let db = open_database("sqlite::memory:").await.unwrap();
    router(
        AppState {
            db,
            revision: "test".into(),
            planner_key: key.map(Into::into),
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
        "worldcup", "swipe", "flip", "roulette", "slot", "ladder", "gacha",
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
