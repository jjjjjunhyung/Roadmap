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
            backup: None,
            origin_secret: None,
            origin_host: None,
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
async fn cannot_open_until_every_step_has_a_candidate() {
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
async fn picker_sees_the_whole_day_and_chooses_in_any_order() {
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
    assert!(v["open"].as_array().unwrap().is_empty() && v["steps"].as_array().unwrap().is_empty());

    plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    let (_, v) = call(&app, Method::GET, &format!("/api/pick/{code}"), None, None).await;
    assert_eq!(v["steps"][0]["state"], "open");
    assert_eq!(v["steps"][1]["state"], "open");
    let open = v["open"].as_array().unwrap();
    assert_eq!(
        (open.len(), open[0]["id"].as_str(), open[1]["id"].as_str()),
        (2, Some(s0), Some(s1))
    );
    assert_eq!(open[1]["candidates"].as_array().unwrap().len(), 3);

    // wrong candidate for the step
    let other = c["steps"][0]["candidates"][0]["id"].as_str().unwrap();
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s1}/pick"),
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

    // the second step first: roulette, one reroll, then none
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
    let (s, v) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s1}/pick"),
        Some(json!({ "candidate_id": last })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["status"], "open");
    assert_eq!(v["steps"][1]["state"], "done");
    assert_eq!(v["steps"][1]["picked"]["name"], "장소1-3");
    assert_eq!(v["open"].as_array().unwrap().len(), 1);
    assert_eq!(v["open"][0]["id"], s0);

    // a decided step cannot be chosen again
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s1}/pick"),
        Some(json!({ "candidate_id": last })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    let first = c["steps"][0]["candidates"][1]["id"].as_str().unwrap();
    let (_, v) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s0}/pick"),
        Some(json!({ "candidate_id": first })),
        None,
    )
    .await;
    assert_eq!(v["status"], "done");
    assert!(v["open"].as_array().unwrap().is_empty());
    assert_eq!(v["steps"][0]["picked"]["name"], "장소0-2");

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

/// A step with a single candidate is the planner's decision ("정해 둠"): shown from the start,
/// never played, and a game again as soon as it gets a second candidate.
#[tokio::test]
async fn single_candidate_steps_are_fixed() {
    let app = app(Some(KEY)).await;
    let mut c = seeded(&app).await;
    let (id, code) = (
        c["id"].as_str().unwrap().to_string(),
        c["share_code"].as_str().unwrap().to_string(),
    );
    let (s0, s1) = (
        c["steps"][0]["id"].as_str().unwrap().to_string(),
        c["steps"][1]["id"].as_str().unwrap().to_string(),
    );
    for i in [2, 1] {
        let cid = c["steps"][1]["candidates"][i]["id"]
            .as_str()
            .unwrap()
            .to_string();
        c = plan(&app, Method::DELETE, &format!("/candidates/{cid}"), None).await;
    }
    assert!(
        c["steps"][1]["picked_id"].is_null(),
        "drafts are not settled"
    );

    let c = plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    assert_eq!(c["status"], "open");
    assert_eq!(c["steps"][1]["picked_by"], "planner");
    let view = || async {
        call(&app, Method::GET, &format!("/api/pick/{code}"), None, None)
            .await
            .1
    };
    let v = view().await;
    assert_eq!(v["steps"][1]["state"], "fixed");
    assert_eq!(v["steps"][1]["picked"]["name"], "장소1-1");
    assert_eq!(v["open"].as_array().unwrap().len(), 1);
    assert_eq!(v["open"][0]["id"], s0.as_str());

    // a fixed step is not played
    let only = c["steps"][1]["candidates"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s1}/pick"),
        Some(json!({ "candidate_id": only })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    // choosing the other step completes the course
    let pick0 = c["steps"][0]["candidates"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (_, v) = call(
        &app,
        Method::POST,
        &format!("/api/pick/{code}/steps/{s0}/pick"),
        Some(json!({ "candidate_id": pick0 })),
        None,
    )
    .await;
    assert_eq!(v["status"], "done");

    // a second candidate makes it a game again, and the course is open once more
    let c = plan(
        &app,
        Method::POST,
        &format!("/steps/{s1}/candidates"),
        Some(json!({ "name": "장소1-9", "map_url": "https://map.kakao.com/?q=x" })),
    )
    .await;
    assert_eq!(c["status"], "open");
    assert!(c["steps"][1]["picked_id"].is_null());
    let v = view().await;
    assert_eq!(v["steps"][1]["state"], "open");
    assert_eq!(v["steps"][0]["state"], "done", "her own pick stays");

    // removing it again fixes the step and completes the course
    let extra = c["steps"][1]["candidates"][1]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let c = plan(&app, Method::DELETE, &format!("/candidates/{extra}"), None).await;
    assert_eq!(
        (c["status"].as_str(), c["steps"][1]["picked_by"].as_str()),
        (Some("done"), Some("planner"))
    );

    // reset clears her picks but not the planner's
    let c = plan(&app, Method::POST, &format!("/courses/{id}/reset"), None).await;
    assert_eq!(c["status"], "open");
    assert!(c["steps"][0]["picked_id"].is_null());
    assert_eq!(c["steps"][1]["picked_by"], "planner");

    // every step fixed: done the moment it is shared
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "draft" })),
    )
    .await;
    for i in [2, 1] {
        let cid = c["steps"][0]["candidates"][i]["id"]
            .as_str()
            .unwrap()
            .to_string();
        plan(&app, Method::DELETE, &format!("/candidates/{cid}"), None).await;
    }
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    assert_eq!(c["status"], "done");
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
    assert_eq!(v["open"][0]["candidates"][0]["image_url"], photo);

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
    let first = &v["open"][0]["candidates"][0];
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

/// A backup is a complete, readable copy of the database, sent with a single PUT.
#[tokio::test]
async fn backup_uploads_a_consistent_copy() {
    use axum::{extract::Path as P, routing::put};
    use reactive_ui_server::backup::{Backup, run_once};
    use std::sync::{Arc, Mutex};

    // a stand-in for Object Storage that keeps what it receives
    type Received = Arc<Mutex<Vec<(String, Vec<u8>)>>>;
    let got: Received = Arc::default();
    let keep = got.clone();
    let store = Router::new().route(
        "/o/{name}",
        put(move |P(name): P<String>, body: axum::body::Bytes| {
            let keep = keep.clone();
            async move {
                keep.lock().unwrap().push((name, body.to_vec()));
                StatusCode::OK
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, store).await.unwrap() });

    // a file database, as in production (an in-memory one would copy into memory too)
    let root = std::env::temp_dir().join(format!("reactive-ui-backup-test-{port}"));
    let dir = root.join("copies");
    std::fs::create_dir_all(&dir).unwrap();
    let db = open_database(&format!("sqlite://{}/app.db", root.display()))
        .await
        .unwrap();
    sqlx::query("INSERT INTO courses (title, date) VALUES ('백업', '2026-12-24')")
        .execute(&db)
        .await
        .unwrap();
    let b = Backup::new(&format!("http://127.0.0.1:{port}/o/"), dir.clone()).unwrap();
    let bytes = run_once(&db, &b).await.unwrap();

    let (name, body) = got.lock().unwrap().pop().unwrap();
    assert!(name.starts_with("app-") && name.ends_with(".db"), "{name}");
    assert_eq!(body.len() as u64, bytes);
    assert!(body.starts_with(b"SQLite format 3\0"));
    assert_eq!(
        std::fs::read_dir(&dir).unwrap().count(),
        0,
        "the local copy is removed"
    );

    // the copy opens and holds the data
    let copy = root.join("restored.db");
    std::fs::write(&copy, &body).unwrap();
    let restored = sqlx::SqlitePool::connect(&format!("sqlite://{}", copy.display()))
        .await
        .unwrap();
    let title: String = sqlx::query_scalar("SELECT title FROM courses")
        .fetch_one(&restored)
        .await
        .unwrap();
    assert_eq!(title, "백업");
    let ok: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&restored)
        .await
        .unwrap();
    assert_eq!(ok, "ok");
    restored.close().await;
    db.close().await;
    std::fs::remove_dir_all(&root).unwrap();

    // a refused upload is reported
    let bad = Backup::new(
        &format!("http://127.0.0.1:{port}/nowhere/"),
        std::env::temp_dir(),
    )
    .unwrap();
    assert!(run_once(&db, &bad).await.is_err());
}

#[tokio::test]
async fn wishes_become_candidates_and_show_once_visited() {
    let app = app(Some(KEY)).await;
    let (_, set, _) = archive_call(
        &app,
        "192.0.2.60",
        Method::POST,
        "/api/archive/unlock",
        Some(json!({ "code": BIRTHDAY })),
        None,
    )
    .await;
    let cookie = set.unwrap().split(';').next().unwrap().to_string();
    let ck = Some(cookie.as_str());
    let wish = |body: Value| {
        let app = app.clone();
        let cookie = cookie.clone();
        async move {
            archive_call(
                &app,
                HOME,
                Method::POST,
                "/api/archive/wishes",
                Some(body),
                Some(&cookie),
            )
            .await
        }
    };

    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::POST,
        "/api/archive/wishes",
        Some(json!({ "link": "https://map.kakao.com/a", "name": "x" })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    // a link from elsewhere carries no name: it has to be typed
    let (s, _, v) = wish(json!({ "link": "https://map.kakao.com/a" })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    let (s, _, picnic) = wish(json!({ "link": "https://map.kakao.com/a", "name": "한강 피크닉", "memo": "돗자리 챙기기" })).await;
    assert_eq!(s, StatusCode::CREATED, "{picnic}");
    assert_eq!(picnic["name"], "한강 피크닉");
    assert!(picnic["visited"].is_null());
    let (s, _, _) = wish(json!({ "link": "https://map.kakao.com/a", "name": "또" })).await;
    assert_eq!(s, StatusCode::CONFLICT, "the same place twice");
    // the whole share text works: the link is found in it
    let (s, _, bar) =
        wish(json!({ "link": "[지도]\n술집\nhttps://map.kakao.com/b 여기!", "name": "작은 술집" }))
            .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(bar["map_url"], "https://map.kakao.com/b");
    let (s, _, _) = wish(json!({ "link": "", "name": "" })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // the planner turns a wish into a candidate, once per step
    let c = seeded(&app).await;
    let (id, s0, s1) = (
        c["id"].as_str().unwrap().to_string(),
        c["steps"][0]["id"].as_str().unwrap().to_string(),
        c["steps"][1]["id"].as_str().unwrap().to_string(),
    );
    let wid = picnic["id"].as_str().unwrap();
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/plan/steps/{s0}/wishes"),
        Some(json!({ "wish_id": wid })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "planner-only");
    let full = plan(
        &app,
        Method::POST,
        &format!("/steps/{s0}/wishes"),
        Some(json!({ "wish_id": wid })),
    )
    .await;
    let cands = full["steps"][0]["candidates"].as_array().unwrap();
    let from_wish = cands.last().unwrap();
    assert_eq!(
        (from_wish["name"].as_str(), from_wish["memo"].as_str()),
        (Some("한강 피크닉"), Some("돗자리 챙기기"))
    );
    assert_eq!(from_wish["map_url"], "https://map.kakao.com/a");
    let (s, v) = call(
        &app,
        Method::POST,
        &format!("/api/plan/steps/{s0}/wishes"),
        Some(json!({ "wish_id": wid })),
        Some(KEY),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");

    let ws = plan(&app, Method::GET, "/wishes", None).await;
    let w = ws
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["id"] == wid)
        .unwrap()
        .clone();
    assert_eq!(w["used"][0]["course_id"], id.as_str());
    assert_eq!(w["used"][0]["status"], "draft");

    // the archive keeps the surprise: nothing shows until a finished course picked it
    let (_, _, list) = archive_call(&app, HOME, Method::GET, "/api/archive/wishes", None, ck).await;
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .all(|w| w["visited"].is_null() && w.get("used").is_none()),
        "{list}"
    );

    let c = plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    let code = c["share_code"].as_str().unwrap();
    let picked = c["steps"][0]["candidates"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let other = c["steps"][1]["candidates"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    for (step, cand) in [(&s0, &picked), (&s1, &other)] {
        let (s, _) = call(
            &app,
            Method::POST,
            &format!("/api/pick/{code}/steps/{step}/pick"),
            Some(json!({ "candidate_id": cand })),
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
    }
    let (_, _, list) = archive_call(&app, HOME, Method::GET, "/api/archive/wishes", None, ck).await;
    let list = list.as_array().unwrap();
    assert_eq!(list.last().unwrap()["id"], wid, "visited ones go last");
    assert_eq!(list.last().unwrap()["visited"]["title"], "크리스마스");
    assert!(list[0]["visited"].is_null());

    // removing a wish keeps the candidate but stops new ones
    let (s, _, _) = archive_call(
        &app,
        HOME,
        Method::DELETE,
        &format!("/api/archive/wishes/{wid}"),
        None,
        ck,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, _, list) = archive_call(&app, HOME, Method::GET, "/api/archive/wishes", None, ck).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    let (s, _) = call(
        &app,
        Method::POST,
        &format!("/api/plan/steps/{s1}/wishes"),
        Some(json!({ "wish_id": wid })),
        Some(KEY),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Hashed build files are cached for a year, the page itself is always revalidated, the API
/// is left alone.
#[tokio::test]
async fn static_files_carry_cache_rules() {
    let dir = std::env::temp_dir().join(format!("reactive-ui-static-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    std::fs::write(dir.join("index.html"), "<!doctype html>").unwrap();
    std::fs::write(dir.join("assets/app-1a2b.js"), "console.log(1)").unwrap();
    let db = open_database("sqlite::memory:").await.unwrap();
    let app = router(
        AppState {
            db,
            revision: "test".into(),
            planner_key: None,
            naver_map_client_id: None,
            archive: None,
            backup: None,
            origin_secret: None,
            origin_host: None,
        },
        Some(&dir),
    );
    let get = |path: &'static str| {
        let app = app.clone();
        async move {
            let res = app
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            (
                res.status(),
                res.headers()
                    .get("cache-control")
                    .map(|v| v.to_str().unwrap().to_string()),
            )
        }
    };
    let (s, cc) = get("/assets/app-1a2b.js").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(cc.as_deref(), Some("public, max-age=31536000, immutable"));
    let (_, cc) = get("/p/abc").await;
    assert_eq!(cc.as_deref(), Some("no-cache"), "the SPA page");
    let (s, cc) = get("/assets/missing.js").await;
    assert_eq!(
        s,
        StatusCode::NOT_FOUND,
        "a missing build file is not the page"
    );
    assert_eq!(cc.as_deref(), Some("no-cache"), "and is not kept");
    let (_, cc) = get("/api/health").await;
    assert_eq!(cc, None);
    std::fs::remove_dir_all(&dir).unwrap();
}

/// origin.<domain> answers only requests that carry CloudFront's secret; the public hostnames
/// are untouched (so a switch back to Cloudflare keeps working).
#[tokio::test]
async fn origin_hostname_needs_cloudfronts_secret() {
    let db = open_database("sqlite::memory:").await.unwrap();
    let app = router(
        AppState {
            db,
            revision: "test".into(),
            planner_key: None,
            naver_map_client_id: None,
            archive: None,
            backup: None,
            origin_secret: Some("cloudfront-shared-secret".into()),
            origin_host: Some("origin.example.com".into()),
        },
        None,
    );
    let get = |host: &'static str, secret: Option<&'static str>| {
        let app = app.clone();
        async move {
            let mut req = Request::builder().uri("/api/health").header("host", host);
            if let Some(s) = secret {
                req = req.header("x-origin-verify", s);
            }
            app.oneshot(req.body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status()
        }
    };
    assert_eq!(get("origin.example.com", None).await, StatusCode::FORBIDDEN);
    assert_eq!(
        get("ORIGIN.example.com:443", Some("wrong")).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        get("origin.example.com", Some("cloudfront-shared-secret")).await,
        StatusCode::OK
    );
    assert_eq!(
        get("example.com", None).await,
        StatusCode::OK,
        "public hostname untouched"
    );
}

/// One switch for the look of every page behind the birthday: the planner sets it, the web app
/// reads it from /api/config.
#[tokio::test]
async fn site_theme_is_one_switch() {
    let app = app(Some(KEY)).await;
    let (_, cfg) = call(&app, Method::GET, "/api/config", None, None).await;
    assert_eq!(cfg["theme"], "plain");

    let (s, _) = call(
        &app,
        Method::PUT,
        "/api/plan/theme",
        Some(json!({ "theme": "holiday" })),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "planner only");
    let v = plan(
        &app,
        Method::PUT,
        "/theme",
        Some(json!({ "theme": "holiday" })),
    )
    .await;
    assert_eq!(v["theme"], "holiday");
    let (_, cfg) = call(&app, Method::GET, "/api/config", None, None).await;
    assert_eq!(cfg["theme"], "holiday");
    assert_eq!(
        plan(&app, Method::GET, "/theme", None).await["theme"],
        "holiday"
    );

    let (s, _) = call(
        &app,
        Method::PUT,
        "/api/plan/theme",
        Some(json!({ "theme": "neon" })),
        Some(KEY),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Planner upload of a candidate's picture: the course as JSON.
async fn upload_picture(app: &Router, cand: &str, bytes: Vec<u8>) -> Value {
    let req = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/plan/candidates/{cand}/image"))
        .header("x-planner-key", KEY)
        .header("content-type", "image/jpeg")
        .body(Body::from(bytes))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert!(res.status().is_success(), "upload -> {}", res.status());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

/// A movie step: one theater for the whole step, candidates that are works with a start time
/// and a running time, and a poster the planner uploads (served publicly, replaced for good).
#[tokio::test]
async fn movie_steps_hold_works_at_one_venue() {
    let app = app(Some(KEY)).await;
    let c = seeded(&app).await;
    let (id, code) = (
        c["id"].as_str().unwrap().to_string(),
        c["share_code"].as_str().unwrap().to_string(),
    );
    let s1 = c["steps"][1]["id"].as_str().unwrap().to_string();

    let (s, _) = call(
        &app,
        Method::PATCH,
        &format!("/api/plan/steps/{s1}"),
        Some(json!({ "kind": "opera" })),
        Some(KEY),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "unknown icon");

    // not a Naver link, so nothing is fetched: the typed name is the venue
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/steps/{s1}"),
        Some(json!({ "kind": "movie", "venue_url": "https://example.com/theater", "venue_name": "시네마 용산" })),
    )
    .await;
    assert_eq!(c["steps"][1]["kind"], "movie");
    assert_eq!(c["steps"][1]["venue_name"], "시네마 용산");

    let cand = c["steps"][1]["candidates"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/candidates/{cand}"),
        Some(json!({ "starts_at": "19:20", "runtime_min": 137, "link_url": "https://example.com/movie/1" })),
    )
    .await;
    let first = &c["steps"][1]["candidates"][0];
    assert_eq!(
        (
            first["starts_at"].as_str(),
            first["runtime_min"].as_i64(),
            first["link_url"].as_str()
        ),
        (
            Some("19:20"),
            Some(137),
            Some("https://example.com/movie/1")
        )
    );
    let (s, _) = call(
        &app,
        Method::PATCH,
        &format!("/api/plan/candidates/{cand}"),
        Some(json!({ "runtime_min": 900 })),
        Some(KEY),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // a poster: stored, public, cached for good
    let c = upload_picture(&app, &cand, phone_photo()).await;
    let poster = c["steps"][1]["candidates"][0]["image_url"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(poster.starts_with("/api/images/"), "{poster}");
    let (s, headers, body) = raw(&app, Method::GET, &poster, vec![], None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(headers["content-type"], "image/jpeg");
    assert!(
        headers["cache-control"]
            .to_str()
            .unwrap()
            .contains("immutable")
    );
    let img = image::load_from_memory(&body).unwrap();
    assert!(img.width().max(img.height()) <= 960);

    // the link: the venue for the step, and for each work its time and the theater's map link
    plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    let (_, v) = call(&app, Method::GET, &format!("/api/pick/{code}"), None, None).await;
    let step = &v["open"][1];
    assert_eq!(step["venue"]["name"], "시네마 용산");
    let w = &step["candidates"][0];
    assert_eq!(
        (w["starts_at"].as_str(), w["runtime_min"].as_i64()),
        (Some("19:20"), Some(137))
    );
    assert_eq!(w["venue"], "시네마 용산");
    assert_eq!(
        w["map_url"], "https://example.com/theater",
        "the theater stands in for its place"
    );
    assert_eq!(w["image_url"], poster.as_str());
    assert!(v["open"][0]["venue"].is_null(), "a place step has no venue");

    // a new poster replaces the old one for good
    let c = upload_picture(&app, &cand, phone_photo()).await;
    assert_ne!(c["steps"][1]["candidates"][0]["image_url"], poster.as_str());
    let (s, _, _) = raw(&app, Method::GET, &poster, vec![], None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// The day as it went: once signed in, a decided stop can be struck through with where they
/// went instead (or that they skipped it). The plan stays, the archive lists the new place, a
/// reset forgets it, and "원래대로" undoes it.
#[tokio::test]
async fn the_day_can_change_a_decided_stop() {
    let app = app(Some(KEY)).await;
    let c = seeded(&app).await;
    let id = c["id"].as_str().unwrap().to_string();
    let c = plan(
        &app,
        Method::PATCH,
        &format!("/courses/{id}"),
        Some(json!({ "status": "open" })),
    )
    .await;
    let code = c["share_code"].as_str().unwrap().to_string();
    let (s0, s1) = (
        c["steps"][0]["id"].as_str().unwrap().to_string(),
        c["steps"][1]["id"].as_str().unwrap().to_string(),
    );
    let at = |step: &str| format!("/api/archive/courses/{code}/steps/{step}/actual");
    let (_, set, _) = archive_call(
        &app,
        "192.0.2.60",
        Method::POST,
        "/api/archive/unlock",
        Some(json!({ "code": BIRTHDAY })),
        None,
    )
    .await;
    let cookie = set.unwrap().split(';').next().unwrap().to_string();
    let ck = Some(cookie.as_str());
    let change = json!({ "name": "동네 국밥집", "memo": "웨이팅이 너무 길었어" });

    let (s, _, _) = archive_call(
        &app,
        "192.0.2.60",
        Method::PUT,
        &at(&s0),
        Some(change.clone()),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "the birthday comes first");
    let (s, _, _) = archive_call(
        &app,
        "192.0.2.60",
        Method::PUT,
        &at(&s0),
        Some(change.clone()),
        ck,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "nothing to strike out before it is decided"
    );

    // decide both stops
    let (_, v) = call(&app, Method::GET, &format!("/api/pick/{code}"), None, None).await;
    for o in v["open"].as_array().unwrap() {
        let (sid, cid) = (
            o["id"].as_str().unwrap(),
            o["candidates"][0]["id"].as_str().unwrap(),
        );
        call(
            &app,
            Method::POST,
            &format!("/api/pick/{code}/steps/{sid}/pick"),
            Some(json!({ "candidate_id": cid })),
            None,
        )
        .await;
    }

    let (s, _, v) = archive_call(&app, "192.0.2.60", Method::PUT, &at(&s0), Some(change), ck).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["steps"][0]["picked"]["name"], "장소0-1", "the plan stays");
    assert_eq!(v["steps"][0]["actual"]["name"], "동네 국밥집");
    assert_eq!(v["steps"][0]["actual"]["skipped"], false);
    let (s, _, v) = archive_call(
        &app,
        "192.0.2.60",
        Method::PUT,
        &at(&s1),
        Some(json!({ "skipped": true, "memo": "비가 와서" })),
        ck,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        (
            v["steps"][1]["actual"]["skipped"].as_bool(),
            v["steps"][1]["actual"]["name"].as_str()
        ),
        (Some(true), Some(""))
    );
    let (s, _, _) = archive_call(
        &app,
        "192.0.2.60",
        Method::PUT,
        &at(&s1),
        Some(json!({ "name": " " })),
        ck,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "somewhere instead needs a name");

    // everyone with the link sees it; the archive lists where they really went
    let (_, v) = call(&app, Method::GET, &format!("/api/pick/{code}"), None, None).await;
    assert_eq!(v["steps"][0]["actual"]["memo"], "웨이팅이 너무 길었어");
    let (_, _, list) =
        archive_call(&app, "192.0.2.60", Method::GET, "/api/archive", None, ck).await;
    let mine = list
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["share_code"] == code.as_str())
        .unwrap();
    assert_eq!(
        (
            mine["stops"][0]["name"].as_str(),
            mine["stops"][0]["changed"].as_str()
        ),
        (Some("동네 국밥집"), Some("replaced"))
    );
    assert_eq!(
        (
            mine["stops"][1]["name"].as_str(),
            mine["stops"][1]["changed"].as_str()
        ),
        (Some("장소1-1"), Some("skipped"))
    );
    // the planner sees it too
    let c = plan(&app, Method::GET, &format!("/courses/{id}"), None).await;
    assert_eq!(c["steps"][0]["actual"]["name"], "동네 국밥집");

    // "원래대로"
    let (s, _, v) = archive_call(&app, "192.0.2.60", Method::DELETE, &at(&s0), None, ck).await;
    assert_eq!(s, StatusCode::OK);
    assert!(v["steps"][0]["actual"].is_null());

    // a reset forgets the day's changes with the picks
    plan(&app, Method::POST, &format!("/courses/{id}/reset"), None).await;
    let c = plan(&app, Method::GET, &format!("/courses/{id}"), None).await;
    assert!(c["steps"][1]["actual"].is_null());
}
