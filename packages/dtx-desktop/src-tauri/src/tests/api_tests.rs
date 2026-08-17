use super::*;
use crate::api_contracts::CreateSimfileLevelInput;
use crate::google_drive::{ApiDriveMetadataClient, DriveMetadataClient};
use crate::workspace::{test_support::managed_workspace_state, WorkspaceRootState};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use std::fs;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration as StdDuration;
use tauri::Listener;
use ts_rs::TS;
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Singleton mutex serializing tests that mutate process-global env vars
/// (PUBLIC_SIMFILE_BUCKET_URL). Without this, parallel test runs race: one
/// test's `set_var` is visible to another test's `remove_var`, producing
/// flaky failures. Each env-mutating test acquires this lock for its full
/// duration.
fn bucket_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct EnvVarGuard {
    name: &'static str,
    previous: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn replace(name: &'static str, value: &str) -> Self {
        let previous = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var(self.name, value),
            None => std::env::remove_var(self.name),
        }
    }
}

fn jwt_with_exp(exp: i64) -> String {
    format!(
        "header.{}.signature",
        URL_SAFE_NO_PAD.encode(json!({ "exp": exp }).to_string())
    )
}

fn gql_simfile() -> Value {
    json!({
        "id": "42",
        "displayId": 7,
        "title": "Song",
        "artist": "Artist",
        "bpm": 180.5,
        "userId": "user-1",
        "googleDriveFileId": "drive-file-42",
        "isPublished": true,
        "downloadUrl": "https://files/song.zip",
        "previewUrl": "https://files/preview.jpg",
        "videoPreviewUrl": null,
        "publishDate": "2024-01-01",
        "createdAt": "2024-01-02",
        "updatedAt": "2024-01-03",
        "dtxFiles": [{ "id": "101", "level": 9.2, "label": "EXT" }]
    })
}

fn gql_simfile_with_id(id: i64) -> Value {
    let mut simfile = gql_simfile();
    simfile["id"] = json!(id.to_string());
    simfile
}

fn owner_drive_simfile() -> Value {
    json!({
        "id": "42",
        "title": "Song",
        "userId": "user-1",
        "googleDriveFileId": "drive-file-42",
        "downloadUrl": "https://drive.google.com/uc?id=drive-file-42"
    })
}

fn create_input_fixture_with_display_id(display_id: Option<i64>) -> CreateSimfileRecordInput {
    CreateSimfileRecordInput {
        title: "Song".to_string(),
        artist: "Artist".to_string(),
        bpm: 180.0,
        display_id,
        is_published: true,
        publish_date: "2024-01-01".to_string(),
        download_url: "https://files/song.zip".to_string(),
        video_preview_url: "https://video".to_string(),
        levels: vec![CreateSimfileLevelInput {
            label: "EXT".to_string(),
            level: 9.2,
        }],
        song_path: String::new(),
    }
}

#[test]
fn api_base_url_trims_whitespace_and_trailing_slash() {
    let base = api_base_url_from_values(Some(" https://api.example.com/ ")).expect("base url");

    assert_eq!(base, "https://api.example.com");
}

#[test]
fn api_base_url_rejects_empty_value() {
    let result = api_base_url_from_values(Some(""));

    assert!(result.is_err());
}

#[test]
fn native_simfile_from_graphql_matches_renderer_fixture() {
    let expected: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/simfile_model.json"))
            .expect("fixture parses");
    let graphql_value = json!({
        "id": "42",
        "displayId": 7,
        "title": "Fixture Song",
        "artist": "Fixture Artist",
        "bpm": 123.5,
        "userId": "user-1",
        "googleDriveFileId": null,
        "isPublished": true,
        "downloadUrl": "https://example.test/chart.zip",
        "previewUrl": null,
        "videoPreviewUrl": null,
        "publishDate": "2026-08-15",
        "createdAt": "2026-08-15T00:00:00Z",
        "updatedAt": "2026-08-15T00:00:01Z",
        "dtxFiles": [{ "id": "99", "label": "EXT", "level": 85.0 }]
    });

    let native = native_simfile_from_graphql(&graphql_value).expect("mapped");
    assert_eq!(serde_json::to_value(native).expect("serializes"), expected);
}

#[test]
fn native_simfile_from_graphql_rejects_missing_null_and_non_array_dtx_files() {
    for (case, dtx_files) in [
        ("missing", None),
        ("null", Some(Value::Null)),
        ("non-array", Some(json!({}))),
    ] {
        let mut graphql_value = gql_simfile();
        match dtx_files {
            Some(dtx_files) => graphql_value["dtxFiles"] = dtx_files,
            None => {
                graphql_value
                    .as_object_mut()
                    .expect("simfile object")
                    .remove("dtxFiles");
            }
        };

        assert!(
            native_simfile_from_graphql(&graphql_value).is_err(),
            "{case} dtxFiles should fail conversion"
        );
    }
}

#[test]
fn native_simfile_from_graphql_rejects_missing_null_and_invalid_dtx_ids() {
    for (case, dtx_file) in [
        ("absent", json!({ "label": "EXT", "level": 9.2 })),
        ("null", json!({ "id": null, "label": "EXT", "level": 9.2 })),
        (
            "invalid",
            json!({ "id": "abc", "label": "EXT", "level": 9.2 }),
        ),
    ] {
        let mut graphql_value = gql_simfile();
        graphql_value["dtxFiles"] = json!([dtx_file]);

        assert!(
            native_simfile_from_graphql(&graphql_value).is_err(),
            "{case} dtx id should fail conversion"
        );
    }
}

#[test]
fn native_simfile_from_graphql_rejects_non_string_nullable_fields() {
    // A nullable string field (e.g. userId) must be null, absent, or a string.
    // A non-string value (number, bool, array) is malformed and must error
    // rather than silently coercing — covering the nullable_string error branch.
    for field in [
        "userId",
        "googleDriveFileId",
        "downloadUrl",
        "previewUrl",
        "videoPreviewUrl",
    ] {
        let mut graphql_value = gql_simfile();
        graphql_value[field] = json!(42);

        assert!(
            native_simfile_from_graphql(&graphql_value).is_err(),
            "{field} as a number should fail conversion"
        );
    }
}

#[test]
fn native_simfile_typescript_keeps_nullable_fields_required() {
    let decl = NativeSimfile::decl(&Default::default());
    assert!(decl.contains("displayId: number | null"));
    assert!(decl.contains("googleDriveFileId: string | null"));
    assert!(!decl.contains("displayId?:"));
    assert!(!decl.contains("googleDriveFileId?:"));
}

#[test]
fn list_simfiles_query_reuses_full_simfile_fragment() {
    assert!(LIST_SIMFILES_QUERY.contains("...DesktopSimfileFull"));
    let document = graphql_document(LIST_SIMFILES_QUERY);
    assert!(document.contains("fragment DesktopSimfileFull on Simfile"));
    assert!(document.contains("googleDriveFileId"));
    assert!(document.contains("createdAt"));
    assert!(document.contains("updatedAt"));
    assert!(document.contains("dtxFiles"));
}

#[test]
fn asset_file_query_uses_moved_full_simfile_fragment_name() {
    assert!(GET_SIMFILE_WITH_FILES_QUERY.contains("...DesktopSimfileFull"));
}

#[tokio::test]
async fn update_simfile_record_impl_sends_typed_input() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(json!({
            "variables": {
                "id": "42",
                "input": { "title": "Updated" }
            }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "updateSimfile": gql_simfile() }
        })))
        .mount(&server)
        .await;

    let input = UpdateSimfileRecordInput {
        title: Some("Updated".to_string()),
        ..Default::default()
    };

    let result = update_simfile_record_impl(&server.uri(), "token-1", "42".to_string(), input)
        .await
        .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], true);
    assert_eq!(result["data"]["title"], "Song");
}

#[test]
fn update_simfile_input_omits_absent_fields() {
    let input = UpdateSimfileRecordInput {
        title: Some("Updated".to_string()),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(input).expect("serializes"),
        json!({ "title": "Updated" })
    );
}

#[test]
fn update_simfile_input_serializes_explicit_null_as_null() {
    // Tri-state: Some(None) is an explicit request to clear the stored
    // value and must reach GraphQL as `null`, distinct from an omitted
    // field (None) which means "leave unchanged". The GraphQL
    // `updateSimfile` resolver applies displayId/downloadUrl/videoPreviewUrl
    // only when the input property is `!== undefined`.
    let input = UpdateSimfileRecordInput {
        display_id: Some(None),
        download_url: Some(None),
        video_preview_url: Some(None),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(input).expect("serializes"),
        json!({
            "displayId": null,
            "downloadUrl": null,
            "videoPreviewUrl": null
        })
    );
}

#[tokio::test]
async fn update_simfile_record_impl_sends_explicit_null_to_graphql() {
    // Wire-level proof that an explicit clear request ({ displayId: null })
    // reaches the GraphQL mutation input as `"displayId": null` rather than
    // being silently omitted. The API intentionally distinguishes null
    // (clear) from undefined (omit) for displayId/downloadUrl/videoPreviewUrl.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "updateSimfile": gql_simfile() }
        })))
        .mount(&server)
        .await;

    let input = UpdateSimfileRecordInput {
        display_id: Some(None),
        ..Default::default()
    };

    update_simfile_record_impl(&server.uri(), "token-1", "42".to_string(), input)
        .await
        .expect("result");

    let requests = server.received_requests().await.expect("received request");
    assert_eq!(requests.len(), 1);
    let body: Value = serde_json::from_slice(&requests[0].body).expect("GraphQL JSON body");
    assert_eq!(body["variables"]["id"], "42");
    assert!(
        body["variables"]["input"]["displayId"].is_null(),
        "explicit null displayId must reach GraphQL as null, not be omitted"
    );
    assert!(
        body["variables"]["input"]
            .as_object()
            .unwrap()
            .contains_key("displayId"),
        "displayId key must be present in the GraphQL input"
    );
    assert!(
        !body["variables"]["input"]
            .as_object()
            .unwrap()
            .contains_key("downloadUrl"),
        "absent fields must remain omitted from the GraphQL input"
    );
}

#[test]
fn update_simfile_input_deserializes_tri_state() {
    // Pinning the deserialization side of the tri-state: an explicit null
    // becomes Some(None) (clear), a missing field becomes None (omit), and a
    // value becomes Some(Some(_)) (set). Without double_option, serde
    // collapses both null and missing into None, silently dropping clears.
    let omitted: UpdateSimfileRecordInput =
        serde_json::from_str(json!({ "title": "T" }).to_string().as_str()).expect("parses");
    assert_eq!(omitted.display_id, None);

    let cleared: UpdateSimfileRecordInput =
        serde_json::from_str(json!({ "displayId": null }).to_string().as_str()).expect("parses");
    assert_eq!(cleared.display_id, Some(None));

    let set: UpdateSimfileRecordInput =
        serde_json::from_str(json!({ "displayId": 7 }).to_string().as_str()).expect("parses");
    assert_eq!(set.display_id, Some(Some(7)));
}

#[test]
fn create_simfile_input_preserves_null_display_id() {
    let input = create_input_fixture_with_display_id(None);
    let value = serde_json::to_value(input).expect("serializes");
    assert!(value.get("displayId").is_some());
    assert!(value["displayId"].is_null());
}

#[tokio::test]
async fn google_drive_fetch_owner_simfile_returns_fresh_owner_metadata() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(header("authorization", "Bearer token-1"))
        .and(body_partial_json(json!({ "variables": { "id": "42" } })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "simfile": owner_drive_simfile() }
        })))
        .mount(&server)
        .await;

    let result = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect("fresh owner simfile");

    assert_eq!(result.id, "42");
    assert_eq!(result.title, "Song");
    assert_eq!(
        result.google_drive_file_id.as_deref(),
        Some("drive-file-42")
    );
    assert_eq!(
        result.download_url.as_deref(),
        Some("https://drive.google.com/uc?id=drive-file-42")
    );

    let requests = server.received_requests().await.expect("received request");
    let body: Value = serde_json::from_slice(&requests[0].body).expect("GraphQL JSON body");
    assert!(body["query"].as_str().expect("query").contains("userId"));
}

#[tokio::test]
async fn google_drive_fetch_owner_simfile_sanitizes_missing_or_null_records() {
    for (simfile, expected) in [
        (
            Value::Null,
            crate::google_drive::DriveMetadataError::DefinitiveUnavailable,
        ),
        (
            json!({}),
            crate::google_drive::DriveMetadataError::InvalidResponse,
        ),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": { "simfile": simfile }
            })))
            .mount(&server)
            .await;

        let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
            .await
            .expect_err("missing owner simfile must be unavailable");

        assert_eq!(error, expected);
    }
}

#[tokio::test]
async fn google_drive_fetch_owner_simfile_sanitizes_graphql_auth_errors() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "errors": [{ "message": "owner account 123 is forbidden", "extensions": { "code": "FORBIDDEN" } }]
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("auth details must not cross the native boundary");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::Authentication
    );
}

#[tokio::test]
async fn google_drive_fetch_owner_simfile_rejects_a_published_row_owned_by_another_user() {
    let server = MockServer::start().await;
    let mut published_other_users_simfile = owner_drive_simfile();
    published_other_users_simfile["userId"] = json!("other-user");
    published_other_users_simfile["googleDriveFileId"] = Value::Null;
    published_other_users_simfile["downloadUrl"] = json!("https://public.example/song.zip");
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "simfile": published_other_users_simfile }
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("a published cross-user row must not become a Drive upload target");

    assert_eq!(error.to_string(), "SIMFILE_UNAVAILABLE");
}

#[tokio::test]
async fn google_drive_owner_parser_validates_expected_id_before_foreign_owner() {
    let mut wrong_record = owner_drive_simfile();
    wrong_record["id"] = json!("wrong-simfile");
    wrong_record["userId"] = json!("other-user");
    let mut malformed_foreign_record = owner_drive_simfile();
    malformed_foreign_record["userId"] = json!("other-user");
    malformed_foreign_record
        .as_object_mut()
        .expect("owner object")
        .remove("downloadUrl");

    for record in [wrong_record, malformed_foreign_record] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": { "simfile": record }
            })))
            .mount(&server)
            .await;

        let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
            .await
            .expect_err("malformed foreign record is not definitive loss");

        assert_eq!(
            error,
            crate::google_drive::DriveMetadataError::InvalidResponse
        );
    }
}

#[tokio::test]
async fn google_drive_owner_parser_rejects_whitespace_only_owner_id_as_invalid() {
    let server = MockServer::start().await;
    let mut malformed = owner_drive_simfile();
    malformed["userId"] = json!(" \t ");
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "simfile": malformed }
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("blank owner ID is malformed, not definitive loss");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::InvalidResponse
    );
}

#[tokio::test]
async fn google_drive_owner_parser_requires_typed_nullable_binding_fields() {
    for field in ["googleDriveFileId", "downloadUrl"] {
        for invalid in [
            None,
            Some(json!({ "unexpected": "object" })),
            Some(json!(42)),
            Some(json!(true)),
        ] {
            let server = MockServer::start().await;
            let mut malformed = owner_drive_simfile();
            match invalid {
                Some(value) => malformed[field] = value,
                None => {
                    malformed
                        .as_object_mut()
                        .expect("owner object")
                        .remove(field);
                }
            }
            Mock::given(method("POST"))
                .and(path("/graphql"))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "data": { "simfile": malformed }
                })))
                .mount(&server)
                .await;

            let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
                .await
                .expect_err("nullable fields must be present as null or string");

            assert_eq!(
                error,
                crate::google_drive::DriveMetadataError::InvalidResponse,
                "{field} accepted an invalid shape"
            );
        }
    }
}

#[tokio::test]
async fn google_drive_owner_metadata_classifies_ambiguous_failures_without_claiming_absence() {
    // Break caught: collapsing auth, service, malformed-response, and network
    // failures into definitive absence, which lets reconciliation delete a
    // recoverable Drive object.
    for (template, expected) in [
        (
            ResponseTemplate::new(401).set_body_json(json!({
                "error": "expired session"
            })),
            crate::google_drive::DriveMetadataError::Authentication,
        ),
        (
            ResponseTemplate::new(500).set_body_json(json!({
                "error": "temporary outage"
            })),
            crate::google_drive::DriveMetadataError::ServiceUnavailable,
        ),
        (
            ResponseTemplate::new(200).set_body_string("not-json"),
            crate::google_drive::DriveMetadataError::InvalidResponse,
        ),
        (
            ResponseTemplate::new(200).set_body_json(json!({
                "errors": [{
                    "message": "owner forbidden",
                    "extensions": { "code": "FORBIDDEN" }
                }]
            })),
            crate::google_drive::DriveMetadataError::Authentication,
        ),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(template)
            .mount(&server)
            .await;

        assert_eq!(
            fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
                .await
                .expect_err("typed metadata failure"),
            expected
        );
    }

    assert_eq!(
        fetch_owner_drive_simfile_impl("http://127.0.0.1:9", "token-1", "42", "user-1",)
            .await
            .expect_err("connection refusal"),
        crate::google_drive::DriveMetadataError::Network
    );
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn google_drive_api_client_persists_a_refreshed_session_through_the_app_context() {
    // The production adapter resolves tokens through its AppHandle. A refresh
    // must emit the existing session-refreshed event, otherwise the renderer
    // persists the revoked refresh token and the next launch loses the session.
    // This is the crate-wide auth-config lock. It is also held by the auth
    // test that asserts the runtime variables are absent, so neither test can
    // observe the other's temporary configuration.
    let _guard = crate::auth::auth_config_env_lock()
        .lock()
        .expect("auth config env lock");
    let api_server = MockServer::start().await;
    let auth_server = MockServer::start().await;
    let stale_token = jwt_with_exp(1);
    let fresh_token = jwt_with_exp(4_102_444_800);

    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": fresh_token,
            "refresh_token": "refresh-new",
            "user": { "id": "user-1" }
        })))
        .mount(&auth_server)
        .await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(header("authorization", format!("Bearer {fresh_token}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "simfile": owner_drive_simfile() }
        })))
        .mount(&api_server)
        .await;

    let _api_url = EnvVarGuard::replace("VITE_DTX_API_URL", &api_server.uri());
    let _supabase_url = EnvVarGuard::replace("PUBLIC_SUPABASE_URL", &auth_server.uri());
    let _anon_key = EnvVarGuard::replace("PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    let state = AuthState::default();
    state
        .set_current_session(Some(json!({
            "access_token": stale_token,
            "refresh_token": "refresh-old",
            "user": { "id": "user-1" }
        })))
        .await;
    let app = tauri::test::mock_app();
    assert!(app.manage(state.clone()));
    let app_handle = app.handle().clone();
    let (event_sender, event_receiver) = mpsc::channel();
    app_handle.listen("session-refreshed", move |event| {
        event_sender
            .send(event.payload().to_string())
            .expect("event receiver remains available");
    });

    let client = ApiDriveMetadataClient::new(app_handle);
    let result = client
        .fetch_owner_simfile(&state, "42")
        .await
        .expect("owner metadata after refresh");

    assert_eq!(result.id, "42");
    let persisted_session: Value = serde_json::from_str(
        &event_receiver
            .recv_timeout(StdDuration::from_secs(1))
            .expect("session-refreshed event"),
    )
    .expect("session event JSON");
    assert_eq!(persisted_session["access_token"], fresh_token);
    assert_eq!(persisted_session["refresh_token"], "refresh-new");
}

#[tokio::test]
async fn google_drive_update_sends_only_the_drive_binding_values() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "updateSimfileDriveFileGuarded": owner_drive_simfile() }
        })))
        .mount(&server)
        .await;

    let result = update_drive_file_impl(
        &server.uri(),
        "token-1",
        "42",
        "drive-file-42",
        "https://drive.google.com/uc?id=drive-file-42",
        "user-1",
        None,
    )
    .await
    .expect("updated drive metadata");

    assert_eq!(result.id, "42");
    assert_eq!(
        result.google_drive_file_id.as_deref(),
        Some("drive-file-42")
    );

    let requests = server.received_requests().await.expect("received request");
    assert_eq!(requests.len(), 1);
    let body: Value = serde_json::from_slice(&requests[0].body).expect("GraphQL JSON body");
    assert_eq!(
        body["variables"],
        json!({
            "id": "42",
            "googleDriveFileId": "drive-file-42",
            "downloadUrl": "https://drive.google.com/uc?id=drive-file-42",
            "expectedPreviousDriveFileId": null,
            "expectNoExistingDriveFile": null
        })
    );
    assert!(body["query"]
        .as_str()
        .expect("query")
        .contains("updateSimfileDriveFileGuarded"));
}

#[tokio::test]
async fn google_drive_update_rejects_a_mismatched_server_binding_response() {
    for changed_response in [
        json!({
            "id": "99",
            "title": "Song",
            "googleDriveFileId": "drive-file-42",
            "downloadUrl": "https://drive.google.com/uc?id=drive-file-42"
        }),
        json!({
            "id": "42",
            "title": "Song",
            "googleDriveFileId": "drive-file-99",
            "downloadUrl": "https://drive.google.com/uc?id=drive-file-42"
        }),
        json!({
            "id": "42",
            "title": "Song",
            "googleDriveFileId": "drive-file-42",
            "downloadUrl": "https://drive.google.com/uc?id=drive-file-99"
        }),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": { "updateSimfileDriveFileGuarded": changed_response }
            })))
            .mount(&server)
            .await;

        let error = update_drive_file_impl(
            &server.uri(),
            "token-1",
            "42",
            "drive-file-42",
            "https://drive.google.com/uc?id=drive-file-42",
            "user-1",
            None,
        )
        .await
        .expect_err("server response must match the requested Drive binding");

        assert_eq!(
            error,
            crate::google_drive::DriveMetadataError::InvalidResponse
        );
    }
}

#[tokio::test]
async fn run_graphql_value_returns_data_for_successful_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(header("authorization", "Bearer token-1"))
        .and(header("user-agent", "DTXDesktopApp"))
        .and(header("x-requested-with", "DTXDesktopApp"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "nextDisplayId": 99 }
        })))
        .mount(&server)
        .await;

    let result = run_graphql_value(&server.uri(), "token-1", "query Test { ok }", json!({})).await;

    assert_eq!(
        result,
        ApiResultValue::Success {
            data: json!({ "nextDisplayId": 99 })
        }
    );
}

#[tokio::test]
async fn run_graphql_value_extracts_first_graphql_error_code() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "errors": [
                { "message": "nope", "extensions": { "code": "FORBIDDEN" } }
            ]
        })))
        .mount(&server)
        .await;

    let result = run_graphql_value(&server.uri(), "token-1", "query Test { ok }", json!({})).await;

    assert_eq!(
        result,
        ApiResultValue::Failure {
            error: "FORBIDDEN: nope".to_string(),
            code: Some("FORBIDDEN".to_string())
        }
    );
}

#[tokio::test]
async fn upload_file_to_api_posts_multipart_with_desktop_headers_and_strips_first_directory() {
    let temp = tempfile::tempdir().expect("tempdir");
    let song_folder = temp.path().join("song");
    fs::create_dir(&song_folder).expect("song dir");
    fs::create_dir(song_folder.join("dir")).expect("nested dir");
    fs::write(song_folder.join("dir").join("kick.wav"), b"audio").expect("audio file");

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload"))
        .and(header("authorization", "Bearer token-1"))
        .and(header("user-agent", "DTXDesktopApp"))
        .and(header("x-requested-with", "DTXDesktopApp"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "message": "File uploaded successfully",
            "file": {
                "fileName": "kick.wav",
                "key": "42/kick.wav",
                "size": 5,
                "contentType": "application/octet-stream",
                "status": "Uploaded"
            }
        })))
        .mount(&server)
        .await;

    let state = managed_workspace_state(temp.path());
    let result = upload_file_with_workspace_state(
        &server.uri(),
        "token-1",
        "dir/kick.wav".to_string(),
        song_folder.to_str().expect("utf8 path").to_string(),
        "42".to_string(),
        &state,
    )
    .await
    .expect("managed workspace upload");

    assert_eq!(result["success"], true);
    assert_eq!(result["data"]["file"]["fileName"], "kick.wav");
}

#[tokio::test]
async fn upload_file_to_api_rejects_paths_outside_song_folder() {
    let temp = tempfile::tempdir().expect("tempdir");
    let song_folder = temp.path().join("song");
    fs::create_dir(&song_folder).expect("song dir");
    fs::write(temp.path().join("secret.wav"), b"audio").expect("secret file");

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "message": "should not upload",
            "file": { "fileName": "secret.wav" }
        })))
        .mount(&server)
        .await;

    let result = upload_file_to_api(
        &server.uri(),
        "token-1",
        "../secret.wav",
        song_folder.to_str().expect("utf8 path"),
        temp.path().to_str().expect("utf8 workspace"),
        "42",
    )
    .await;

    assert_eq!(result["success"], false);
    assert_eq!(result["error"], "File path is outside song folder");
}

#[tokio::test]
async fn read_preview_rejects_song_folder_outside_workspace() {
    let workspace = tempfile::tempdir().expect("workspace");
    let outside = tempfile::tempdir().expect("outside");
    fs::write(outside.path().join("preview.jpg"), b"img").expect("preview");

    let result = read_preview_within_workspace(
        outside.path().to_str().unwrap(),
        workspace.path().to_str().unwrap(),
        "preview.jpg",
    )
    .await;

    assert!(matches!(result, Err(ref e) if e.contains("outside the workspace")));
}

#[tokio::test]
async fn read_preview_rejects_missing_workspace_root() {
    let song = tempfile::tempdir().expect("song");

    let result =
        read_preview_within_workspace(song.path().to_str().unwrap(), "", "preview.jpg").await;

    assert!(matches!(result, Err(ref e) if e.contains("workspace root is required")));
}

#[tokio::test]
async fn read_preview_returns_none_when_file_absent() {
    let workspace = tempfile::tempdir().expect("workspace");
    let song = workspace.path().join("song");
    fs::create_dir(&song).expect("song dir");

    let result = read_preview_within_workspace(
        song.to_str().unwrap(),
        workspace.path().to_str().unwrap(),
        "preview.jpg",
    )
    .await;

    assert!(matches!(result, Ok(None)));
}

#[tokio::test]
async fn read_preview_reads_file_inside_workspace() {
    let workspace = tempfile::tempdir().expect("workspace");
    let song = workspace.path().join("song");
    fs::create_dir(&song).expect("song dir");
    fs::write(song.join("preview.jpg"), b"img").expect("preview");

    let result = read_preview_within_workspace(
        song.to_str().unwrap(),
        workspace.path().to_str().unwrap(),
        "preview.jpg",
    )
    .await;

    assert!(matches!(result, Ok(Some(ref bytes)) if bytes == b"img"));
}

#[test]
fn number_id_accepts_i64_and_numeric_strings_but_rejects_overflow_and_invalid_types() {
    assert_eq!(number_id(&json!(42)).unwrap(), 42);
    assert_eq!(number_id(&json!(-7)).unwrap(), -7);
    assert_eq!(number_id(&json!("123")).unwrap(), 123);
    assert!(number_id(&json!(u64::MAX)).is_err());
    assert!(number_id(&json!(null)).is_err());
    assert!(number_id(&json!([1, 2])).is_err());
    assert!(number_id(&json!("not a number")).is_err());
}

#[test]
fn upload_name_from_file_name_strips_only_the_leading_segment() {
    assert_eq!(upload_name_from_file_name("kick.wav"), "kick.wav");
    assert_eq!(upload_name_from_file_name("drums/kick.wav"), "kick.wav");
    assert_eq!(upload_name_from_file_name("a/b/c.wav"), "b/c.wav");
    assert_eq!(upload_name_from_file_name("/foo.wav"), "foo.wav");
}

#[tokio::test]
async fn run_graphql_value_extracts_error_field_on_non_success_status() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(502).set_body_json(json!({ "error": "boom" })))
        .mount(&server)
        .await;

    let result = run_graphql_value_with_client(
        reqwest::Client::new(),
        &server.uri(),
        "token-1",
        "query Test { ok }",
        json!({}),
    )
    .await;

    assert!(
        matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("boom"))
    );
}

#[tokio::test]
async fn run_graphql_value_extracts_message_field_when_error_absent() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(502).set_body_json(json!({ "message": "failed" })))
        .mount(&server)
        .await;

    let result = run_graphql_value_with_client(
        reqwest::Client::new(),
        &server.uri(),
        "token-1",
        "query Test { ok }",
        json!({}),
    )
    .await;

    assert!(
        matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("failed"))
    );
}

#[tokio::test]
async fn run_graphql_value_falls_back_to_http_status_without_error_fields() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(502).set_body_json(json!({})))
        .mount(&server)
        .await;

    let result = run_graphql_value_with_client(
        reqwest::Client::new(),
        &server.uri(),
        "token-1",
        "query Test { ok }",
        json!({}),
    )
    .await;

    assert!(
        matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("502"))
    );
}

#[tokio::test]
async fn run_graphql_value_fails_when_success_body_is_not_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;

    let result = run_graphql_value_with_client(
        reqwest::Client::new(),
        &server.uri(),
        "token-1",
        "query Test { ok }",
        json!({}),
    )
    .await;

    assert!(matches!(result, ApiResultValue::Failure { .. }));
}

#[tokio::test]
async fn run_graphql_value_returns_status_text_for_non_success_non_json_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(500).set_body_string("server error"))
        .mount(&server)
        .await;

    let result = run_graphql_value_with_client(
        reqwest::Client::new(),
        &server.uri(),
        "token-1",
        "query Test { ok }",
        json!({}),
    )
    .await;

    assert!(
        matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("Server"))
    );
}

#[tokio::test]
async fn run_graphql_value_surfaces_graphql_error_without_extensions_code() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "errors": [{ "message": "Something went wrong" }]
        })))
        .mount(&server)
        .await;

    let result = run_graphql_value_with_client(
        reqwest::Client::new(),
        &server.uri(),
        "token-1",
        "query Test { ok }",
        json!({}),
    )
    .await;

    assert!(
        matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("Something went wrong"))
    );
}

#[tokio::test]
async fn run_graphql_value_falls_back_when_graphql_error_has_no_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "errors": [{}] })))
        .mount(&server)
        .await;

    let result = run_graphql_value_with_client(
        reqwest::Client::new(),
        &server.uri(),
        "token-1",
        "query Test { ok }",
        json!({}),
    )
    .await;

    assert!(
        matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("GraphQL"))
    );
}

#[tokio::test]
async fn run_graphql_value_fails_on_network_error() {
    let result = run_graphql_value_with_client(
        reqwest::Client::new(),
        "http://127.0.0.1:1",
        "token-1",
        "query Test { ok }",
        json!({}),
    )
    .await;

    assert!(matches!(result, ApiResultValue::Failure { code: None, .. }));
}

#[tokio::test]
async fn upload_form_to_api_extracts_error_field_on_non_success_status() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({ "error": "forbidden" })))
        .mount(&server)
        .await;

    let form = reqwest::multipart::Form::new().text("field", "value");
    let result = upload_form_to_api(&server.uri(), "token-1", form).await;

    assert_eq!(result["success"], false);
    assert_eq!(result["error"], "forbidden");
}

#[tokio::test]
async fn upload_form_to_api_returns_status_text_for_non_success_non_json_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload"))
        .respond_with(ResponseTemplate::new(500).set_body_string("crash"))
        .mount(&server)
        .await;

    let form = reqwest::multipart::Form::new().text("field", "value");
    let result = upload_form_to_api(&server.uri(), "token-1", form).await;

    assert_eq!(result["success"], false);
    assert!(result["error"].as_str().unwrap().contains("Server"));
}

#[tokio::test]
async fn upload_form_to_api_fails_when_success_body_is_not_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload"))
        .respond_with(ResponseTemplate::new(200).set_body_string("ok"))
        .mount(&server)
        .await;

    let form = reqwest::multipart::Form::new().text("field", "value");
    let result = upload_form_to_api(&server.uri(), "token-1", form).await;

    assert_eq!(result["success"], false);
}

#[tokio::test]
async fn upload_form_to_api_fails_on_network_error() {
    let form = reqwest::multipart::Form::new().text("field", "value");
    let result = upload_form_to_api("http://127.0.0.1:1", "token-1", form).await;

    assert_eq!(result["success"], false);
}

#[tokio::test]
async fn upload_file_to_api_fails_when_song_folder_is_missing() {
    let workspace = tempfile::tempdir().expect("workspace");
    let result = upload_file_to_api(
        "https://api.example.com",
        "token-1",
        "kick.wav",
        "/this/path/does/not/exist",
        workspace.path().to_str().expect("utf8 workspace"),
        "42",
    )
    .await;

    assert_eq!(result["success"], false);
    assert!(result["error"]
        .as_str()
        .is_some_and(|error| !error.is_empty()));
}

#[tokio::test]
async fn upload_file_rejects_when_managed_workspace_is_unset_before_request() {
    // Moving the root lookup after upload_file_to_api would allow an HTTP
    // upload attempt even though the desktop has no trusted workspace.
    let server = MockServer::start().await;
    let state = WorkspaceRootState::default();

    let result = upload_file_with_workspace_state(
        &server.uri(),
        "token-1",
        "kick.wav".to_string(),
        "/untrusted/song".to_string(),
        "42".to_string(),
        &state,
    )
    .await;

    assert!(result.is_err());
    assert!(result
        .expect_err("managed workspace is required")
        .to_string()
        .contains("workspace root is required"));
    assert!(server
        .received_requests()
        .await
        .expect("received requests")
        .is_empty());
}

#[tokio::test]
async fn upload_file_to_api_fails_when_file_missing_within_folder() {
    let temp = tempfile::tempdir().expect("tempdir");

    let result = upload_file_to_api(
        "https://api.example.com",
        "token-1",
        "missing.wav",
        temp.path().to_str().expect("utf8 path"),
        temp.path().to_str().expect("utf8 workspace"),
        "42",
    )
    .await;

    assert_eq!(result["success"], false);
    assert!(result["error"].as_str().unwrap().contains("File not found"));
}

#[tokio::test]
async fn get_preview_url_rejects_non_positive_ids() {
    assert!(get_preview_url(0).await.is_err());
    assert!(get_preview_url(-1).await.is_err());
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn get_preview_urls_build_paths_from_bucket_env() {
    // Holds the env lock across `.await`. Safe here because the lock is only
    // contended by other env-mutating tests (which block on this test's
    // completion before reading), and the awaited future (get_preview_url)
    // never tries to re-acquire the same lock — no deadlock risk.
    let _guard = bucket_env_lock().lock().unwrap();
    std::env::set_var("PUBLIC_SIMFILE_BUCKET_URL", "https://bucket.example.com");
    let preview = get_preview_url(42).await.expect("preview url");
    let sound = get_sound_preview_url(42).await.expect("sound preview url");
    std::env::remove_var("PUBLIC_SIMFILE_BUCKET_URL");

    assert!(preview.contains("/42/preview.jpg"));
    assert!(sound.contains("/42/preview.mp3"));
}

#[tokio::test]
async fn access_token_from_auth_state_errors_without_session() {
    let state = AuthState::default();

    assert!(access_token_from_auth_state(&state, None::<&AppHandle>)
        .await
        .is_err());
}

#[tokio::test]
async fn access_token_from_auth_state_returns_token_from_session() {
    let state = AuthState::default();
    state
        .set_current_session(Some(json!({ "access_token": "tok-1" })))
        .await;

    let token = access_token_from_auth_state(&state, None::<&AppHandle>)
        .await
        .expect("token");

    assert_eq!(token, "tok-1");
}

#[tokio::test]
async fn fetch_user_simfiles_impl_returns_single_page() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(header("authorization", "Bearer token-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {
                "simfiles": {
                    "data": [gql_simfile()],
                    "count": 1
                }
            }
        })))
        .mount(&server)
        .await;

    let result = fetch_user_simfiles_impl(&server.uri(), "token-1")
        .await
        .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], true);
    assert_eq!(result["data"].as_array().unwrap().len(), 1);
    assert_eq!(result["fromCache"], false);
}

#[tokio::test]
async fn fetch_user_simfiles_impl_paginates_across_multiple_pages() {
    let server = MockServer::start().await;

    let page1_data = (0..100).map(gql_simfile_with_id).collect::<Vec<_>>();
    let page2_data = (100..200).map(gql_simfile_with_id).collect::<Vec<_>>();
    let page3_data = (200..250).map(gql_simfile_with_id).collect::<Vec<_>>();

    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(json!({ "variables": { "page": 1 } })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "simfiles": { "data": page1_data, "count": 250 } }
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(json!({ "variables": { "page": 2 } })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "simfiles": { "data": page2_data, "count": 250 } }
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(json!({ "variables": { "page": 3 } })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "simfiles": { "data": page3_data, "count": 250 } }
        })))
        .mount(&server)
        .await;

    let result = fetch_user_simfiles_impl(&server.uri(), "token-1")
        .await
        .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], true);
    assert_eq!(result["data"].as_array().unwrap().len(), 250);
}

#[tokio::test]
async fn fetch_user_simfiles_impl_returns_partial_data_on_mid_pagination_failure() {
    let server = MockServer::start().await;

    let page1_data = (0..100).map(gql_simfile_with_id).collect::<Vec<_>>();

    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(json!({ "variables": { "page": 1 } })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "simfiles": { "data": page1_data, "count": 200 } }
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(json!({ "variables": { "page": 2 } })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "errors": [{ "message": "boom", "extensions": { "code": "INTERNAL" } }]
        })))
        .mount(&server)
        .await;

    let result = fetch_user_simfiles_impl(&server.uri(), "token-1")
        .await
        .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], false);
    assert_eq!(result["data"].as_array().unwrap().len(), 100);
    assert_eq!(result["fromCache"], false);
}

#[tokio::test]
async fn get_next_display_id_impl_returns_id() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": { "nextDisplayId": 42 } })),
        )
        .mount(&server)
        .await;

    let id = get_next_display_id_impl(&server.uri(), "token-1")
        .await
        .expect("id");

    assert_eq!(id, 42);
}

#[tokio::test]
async fn get_next_display_id_impl_errors_when_missing() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": {} })))
        .mount(&server)
        .await;

    assert!(get_next_display_id_impl(&server.uri(), "token-1")
        .await
        .is_err());
}

#[tokio::test]
async fn search_cloud_songs_impl_returns_mapped_rows() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {
                "simfileSearch": [
                    {
                        "id": 1,
                        "title": "Song",
                        "artist": "Artist",
                        "bpm": 180,
                        "isPublished": true
                    }
                ]
            }
        })))
        .mount(&server)
        .await;

    let result = search_cloud_songs_impl(&server.uri(), "token-1", "Song".to_string(), None, None)
        .await
        .expect("result");

    assert_eq!(result["success"], true);
    assert_eq!(result["data"].as_array().unwrap().len(), 1);
    assert_eq!(result["data"][0]["id"], 1);
    assert_eq!(result["data"][0]["title"], "Song");
    assert_eq!(result["data"][0]["isPublished"], true);
}

#[tokio::test]
async fn search_cloud_songs_impl_returns_empty_array_for_no_results() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": { "simfileSearch": [] } })),
        )
        .mount(&server)
        .await;

    let result =
        search_cloud_songs_impl(&server.uri(), "token-1", "nothing".to_string(), None, None)
            .await
            .expect("result");

    assert_eq!(result["success"], true);
    assert_eq!(result["data"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn search_cloud_songs_impl_returns_failure_on_graphql_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "errors": [{ "message": "boom" }]
        })))
        .mount(&server)
        .await;

    let result = search_cloud_songs_impl(&server.uri(), "token-1", "Song".to_string(), None, None)
        .await
        .expect("result");

    assert_eq!(result["success"], false);
}

#[tokio::test]
async fn fetch_cloud_song_impl_returns_cloud_song_data_when_found() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "data": { "simfile": gql_simfile() } })),
        )
        .mount(&server)
        .await;

    let result = fetch_cloud_song_impl(&server.uri(), "token-1", "42".to_string())
        .await
        .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], true);
    assert_eq!(result["cloudSongData"]["id"], 42);
    assert_eq!(result["cloudSongData"]["title"], "Song");
    assert_eq!(result["cloudSongData"]["isPublished"], true);
    assert_eq!(result["cloudSongData"]["createdAt"], "2024-01-02");
}

#[tokio::test]
async fn fetch_cloud_song_impl_returns_failure_when_simfile_null() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": { "simfile": null } })),
        )
        .mount(&server)
        .await;

    let result = fetch_cloud_song_impl(&server.uri(), "token-1", "42".to_string())
        .await
        .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], false);
    assert_eq!(result["error"], "Simfile not found");
}

#[tokio::test]
async fn update_simfile_record_impl_returns_updated_simfile() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "updateSimfile": gql_simfile() }
        })))
        .mount(&server)
        .await;

    let result = update_simfile_record_impl(
        &server.uri(),
        "token-1",
        "42".to_string(),
        UpdateSimfileRecordInput {
            title: Some("Updated".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], true);
    assert_eq!(result["data"]["id"], 42);
    assert_eq!(result["data"]["title"], "Song");
    assert_eq!(result["data"]["isPublished"], true);
}

#[tokio::test]
async fn update_simfile_record_impl_returns_failure_on_graphql_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "errors": [{ "message": "forbidden" }]
        })))
        .mount(&server)
        .await;

    let result = update_simfile_record_impl(
        &server.uri(),
        "token-1",
        "42".to_string(),
        UpdateSimfileRecordInput::default(),
    )
    .await
    .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], false);
}

#[tokio::test]
async fn load_asset_files_impl_short_circuits_for_zero_or_empty_id() {
    let server = MockServer::start().await;

    for id in ["0", ""] {
        let result = load_asset_files_impl(&server.uri(), "token-1", id.to_string())
            .await
            .expect("result");

        assert_eq!(result["success"], true);
        assert_eq!(result["data"].as_array().unwrap().len(), 0);
    }

    assert_eq!(server.received_requests().await.unwrap().len(), 0);
}

#[tokio::test]
async fn load_asset_files_impl_strips_id_prefix_from_file_keys() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {
                "simfile": {
                    "id": "42",
                    "files": [
                        { "key": "42/kick.wav", "size": 100, "uploaded": "2024-01-01" },
                        { "key": "42/dir/snare.wav", "size": 200, "uploaded": "2024-01-02" }
                    ]
                }
            }
        })))
        .mount(&server)
        .await;

    let result = load_asset_files_impl(&server.uri(), "token-1", "42".to_string())
        .await
        .expect("result");

    assert_eq!(result["success"], true);
    let files = result["data"].as_array().unwrap();
    assert_eq!(files.len(), 2);
    assert_eq!(files[0]["fileName"], "kick.wav");
    assert_eq!(files[0]["key"], "42/kick.wav");
    assert_eq!(files[0]["size"], 100);
    assert_eq!(files[1]["fileName"], "dir/snare.wav");
}

#[tokio::test]
async fn load_asset_files_impl_returns_empty_for_not_found_code() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "errors": [{ "message": "not found", "extensions": { "code": "NOT_FOUND" } }]
        })))
        .mount(&server)
        .await;

    let result = load_asset_files_impl(&server.uri(), "token-1", "42".to_string())
        .await
        .expect("result");

    assert_eq!(result["success"], true);
    assert_eq!(result["data"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn load_asset_files_impl_returns_empty_when_no_files_array() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": { "simfile": {} } })),
        )
        .mount(&server)
        .await;

    let result = load_asset_files_impl(&server.uri(), "token-1", "42".to_string())
        .await
        .expect("result");

    assert_eq!(result["success"], true);
    assert_eq!(result["data"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn create_simfile_record_impl_creates_without_previews_when_no_song_path() {
    let server = MockServer::start().await;
    let workspace = tempfile::tempdir().expect("workspace");
    let expected_variables = json!({
        "input": {
            "title": "Song",
            "artist": "Artist",
            "bpm": 180.0,
            "displayId": null,
            "isPublished": true,
            "publishDate": "2024-01-01",
            "downloadUrl": "https://files/song.zip",
            "videoPreviewUrl": "https://video",
            "dtxFiles": [{ "label": "EXT", "level": 9.2 }]
        }
    });
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(json!({
            "variables": expected_variables.clone()
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "createSimfile": gql_simfile() }
        })))
        .mount(&server)
        .await;

    let state = managed_workspace_state(workspace.path());
    let result = create_simfile_record_with_workspace_state(
        &server.uri(),
        "token-1",
        create_input_fixture_with_display_id(None),
        &state,
    )
    .await
    .expect("result");
    let result = serde_json::to_value(result).expect("serializes");
    let requests = server.received_requests().await.expect("received requests");
    assert_eq!(requests.len(), 1);
    let body: Value = serde_json::from_slice(&requests[0].body).expect("GraphQL JSON body");
    assert_eq!(body["variables"], expected_variables);
    assert!(body["variables"]["input"].get("levels").is_none());
    assert!(body["variables"]["input"].get("songPath").is_none());

    assert_eq!(result["success"], true);
    assert_eq!(result["simfileId"], "42");
    assert_eq!(result["data"]["id"], 42);
    assert_eq!(result["data"]["isPublished"], true);
    assert!(result.get("warnings").is_none());
}

#[tokio::test]
async fn create_simfile_record_impl_skips_previews_when_files_absent() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "createSimfile": gql_simfile() }
        })))
        .mount(&server)
        .await;

    let workspace = tempfile::tempdir().expect("workspace");
    let song = workspace.path().join("song");
    fs::create_dir(&song).expect("song dir");

    let mut simfile_data = create_input_fixture_with_display_id(None);
    simfile_data.song_path = song.to_str().unwrap().to_string();
    let result =
        create_simfile_record_impl(&server.uri(), "token-1", simfile_data, workspace.path())
            .await
            .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], true);
    assert!(result.get("warnings").is_none());
}

#[tokio::test]
async fn get_sound_preview_url_rejects_non_positive_ids() {
    // Symmetric with get_preview_url: an invalid id must surface as an error
    // rather than producing a malformed bucket URL.
    assert!(get_sound_preview_url(0).await.is_err());
    assert!(get_sound_preview_url(-5).await.is_err());
}

#[test]
fn bucket_base_url_from_env_errors_when_unset() {
    // The CI/test environment does not bake in PUBLIC_SIMFILE_BUCKET_URL, so
    // the resolver must surface a clear error rather than silently producing
    // a malformed URL. Synchronous test (no await) so the env lock can be
    // held cleanly without tripping clippy::await_holding_lock.
    let _guard = bucket_env_lock().lock().unwrap();
    std::env::remove_var("PUBLIC_SIMFILE_BUCKET_URL");
    let result = std::thread::spawn(bucket_base_url_from_env)
        .join()
        .expect("thread");
    assert!(result.is_err());
}

#[test]
fn bucket_base_url_from_env_trims_whitespace_and_trailing_slash() {
    // The renderer concatenates the bucket base with `/{id}/preview.{ext}`;
    // a stray trailing slash would yield `//42/preview.jpg`, so the resolver
    // must normalize. Sync test for the same reason as above.
    let _guard = bucket_env_lock().lock().unwrap();
    std::env::set_var(
        "PUBLIC_SIMFILE_BUCKET_URL",
        "  https://bucket.example.com/  ",
    );
    let url = bucket_base_url_from_env().expect("bucket url");
    std::env::remove_var("PUBLIC_SIMFILE_BUCKET_URL");

    assert_eq!(url, "https://bucket.example.com");
}

#[test]
fn api_failure_envelope_carries_success_false_and_error_message() {
    let value = api_failure("something went wrong");

    assert_eq!(value["success"], false);
    assert_eq!(value["error"], "something went wrong");
}

#[test]
fn api_success_envelope_wraps_payload_under_data_key() {
    let value = api_success(json!({ "count": 3 }));

    assert_eq!(value["success"], true);
    assert_eq!(value["data"]["count"], 3);
}

#[test]
fn graphql_document_prefixes_operation_with_desktop_simfile_full_fragment() {
    // The fragment defines the field set the renderer depends on; omitting it
    // would make the GraphQL request fail with "Cannot query field on type
    // Simfile".
    let document = graphql_document("query Foo { simfile { id } }");

    assert!(document.contains("fragment DesktopSimfileFull on Simfile"));
    assert!(document.contains("query Foo { simfile { id } }"));
    // Fragment comes first so subsequent spreads resolve.
    assert!(
        document.find("fragment DesktopSimfileFull").unwrap() < document.find("query Foo").unwrap()
    );
}

#[test]
fn number_id_rejects_object_and_array_input() {
    // Defensive: a malformed renderer payload must surface as an error rather
    // than panicking inside number_id.
    assert!(number_id(&json!({ "id": "x" })).is_err());
    assert!(number_id(&json!([1, 2, 3])).is_err());
    assert!(number_id(&Value::Null).is_err());
}

#[test]
fn number_id_accepts_u64_that_fits_in_i64() {
    // IDs coming from JSON could deserialize as u64; values within i64 range
    // must convert cleanly. (Anything outside i64 range must error — covered
    // by number_id_accepts_i64_and_numeric_strings_but_rejects_overflow_and_invalid_types.)
    let value: u64 = 123_456;
    assert_eq!(number_id(&json!(value)).unwrap(), 123_456);
}

#[test]
fn reqwest_client_builder_produces_usable_client() {
    // Sanity: the helper must succeed in constructing a client — failures
    // here would indicate a TLS/build configuration issue.
    let client = reqwest_client();
    assert!(client.is_ok());
}

#[test]
fn api_result_value_success_data_returns_ok_for_success() {
    let result = ApiResultValue::Success {
        data: json!({ "ok": true }),
    };

    assert_eq!(result.success_data().unwrap(), json!({ "ok": true }));
}

#[test]
fn api_result_value_success_data_returns_error_tuple_for_failure() {
    let result = ApiResultValue::Failure {
        error: "boom".to_string(),
        code: Some("INTERNAL".to_string()),
    };

    let (error, code) = result.success_data().unwrap_err();
    assert_eq!(error, "boom");
    assert_eq!(code.as_deref(), Some("INTERNAL"));
}

// ---------------------------------------------------------------------------
// upload_name_from_file_name
// ---------------------------------------------------------------------------

#[test]
fn upload_name_from_file_name_strips_leading_slash_prefix() {
    let name = upload_name_from_file_name("subfolder/song.dtx");
    assert_eq!(name, "song.dtx");
}

#[test]
fn upload_name_from_file_name_preserves_deep_subfolder() {
    let name = upload_name_from_file_name("a/b/c.dtx");
    assert_eq!(name, "b/c.dtx");
}

#[test]
fn upload_name_from_file_name_returns_original_when_no_slash() {
    assert_eq!(upload_name_from_file_name("song.dtx"), "song.dtx");
}

#[test]
fn upload_name_from_file_name_falls_back_when_only_slash() {
    assert_eq!(upload_name_from_file_name("/song.dtx"), "song.dtx");
}

// ---------------------------------------------------------------------------
// upload_file_to_api error paths (temp-file based, no wiremock needed)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn upload_file_to_api_fails_when_song_folder_missing() {
    let workspace = tempfile::tempdir().unwrap();
    let result = upload_file_to_api(
        "https://example.com",
        "token",
        "song.dtx",
        "/nonexistent-folder-12345",
        workspace.path().to_str().unwrap(),
        "sim-1",
    )
    .await;

    assert_eq!(result["success"], false);
    assert!(result["error"]
        .as_str()
        .is_some_and(|error| !error.is_empty()));
}

#[tokio::test]
async fn upload_file_to_api_fails_when_file_missing() {
    let dir = tempfile::tempdir().unwrap();

    let result = upload_file_to_api(
        "https://example.com",
        "token",
        "nonexistent.dtx",
        dir.path().to_str().unwrap(),
        dir.path().to_str().unwrap(),
        "sim-1",
    )
    .await;

    assert_eq!(result["success"], false);
    assert!(result["error"].as_str().unwrap().contains("File not found"));
}

#[tokio::test]
async fn upload_file_to_api_rejects_path_outside_song_folder() {
    let song_dir = tempfile::tempdir().unwrap();
    let outside_dir = tempfile::tempdir().unwrap();
    let outside_file = outside_dir.path().join("secret.dtx");
    fs::write(&outside_file, b"#TITLE: Test").unwrap();

    let result = upload_file_to_api(
        "https://example.com",
        "token",
        // Simulate a path-traversal attempt
        &format!(
            "../{}/secret.dtx",
            outside_dir.path().file_name().unwrap().to_string_lossy()
        ),
        song_dir.path().to_str().unwrap(),
        song_dir.path().to_str().unwrap(),
        "sim-1",
    )
    .await;

    assert_eq!(result["success"], false);
    assert_eq!(result["error"], "File path is outside song folder");
}

#[tokio::test]
async fn upload_file_to_api_rejects_song_folder_outside_workspace() {
    // A compromised renderer passing song_folder_path outside the workspace
    // must be rejected before any file is read or uploaded.
    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let outside_song = outside.path().join("song");
    fs::create_dir(&outside_song).unwrap();
    fs::write(outside_song.join("main.dtx"), b"#TITLE: Test").unwrap();

    let result = upload_file_to_api(
        "https://example.com",
        "token",
        "main.dtx",
        outside_song.to_str().unwrap(),
        workspace.path().to_str().unwrap(),
        "sim-1",
    )
    .await;

    assert_eq!(result["success"], false);
    assert!(result["error"]
        .as_str()
        .is_some_and(|error| error.contains("outside the workspace")));
}

// ---------------------------------------------------------------------------
// read_preview_within_workspace (temp-file based)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn read_preview_within_workspace_rejects_empty_workspace_root() {
    let result = read_preview_within_workspace("/some/song", "", "preview.jpg").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("workspace root"));
}

#[tokio::test]
async fn read_preview_within_workspace_rejects_nonexistent_workspace_root() {
    let result = read_preview_within_workspace(
        "/some/song",
        "/nonexistent-workspace-root-12345",
        "preview.jpg",
    )
    .await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Workspace root not found"));
}

#[tokio::test]
async fn read_preview_within_workspace_rejects_song_outside_workspace() {
    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();

    let result = read_preview_within_workspace(
        outside.path().to_str().unwrap(),
        workspace.path().to_str().unwrap(),
        "preview.jpg",
    )
    .await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("outside the workspace"));
}

#[tokio::test]
async fn read_preview_within_workspace_returns_none_when_preview_absent() {
    let workspace = tempfile::tempdir().unwrap();
    let song = workspace.path().join("mysong");
    fs::create_dir(&song).unwrap();

    let result = read_preview_within_workspace(
        song.to_str().unwrap(),
        workspace.path().to_str().unwrap(),
        "preview.jpg",
    )
    .await;

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), None);
}

#[tokio::test]
async fn read_preview_within_workspace_returns_bytes_when_preview_present() {
    let workspace = tempfile::tempdir().unwrap();
    let song = workspace.path().join("mysong");
    fs::create_dir(&song).unwrap();
    fs::write(song.join("preview.jpg"), b"image-bytes").unwrap();

    let result = read_preview_within_workspace(
        song.to_str().unwrap(),
        workspace.path().to_str().unwrap(),
        "preview.jpg",
    )
    .await;

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), Some(b"image-bytes".to_vec()));
}

#[cfg(unix)]
#[tokio::test]
async fn read_preview_rejects_symlink_pointing_outside_workspace() {
    use std::os::unix::fs::symlink;

    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let song = workspace.path().join("song");
    fs::create_dir(&song).unwrap();

    // File outside the workspace that the symlink will target.
    let secret = outside.path().join("secret.jpg");
    fs::write(&secret, b"secret-bytes").unwrap();

    // Symlink inside the song folder pointing outside the workspace.
    symlink(&secret, song.join("preview.jpg")).unwrap();

    let result = read_preview_within_workspace(
        song.to_str().unwrap(),
        workspace.path().to_str().unwrap(),
        "preview.jpg",
    )
    .await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("outside the workspace"));
}

// ---------------------------------------------------------------------------
// Wiremock-based: timeouts and NOT_FOUND paths
// ---------------------------------------------------------------------------

#[tokio::test]
async fn run_graphql_value_times_out_on_slow_server() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(5)))
        .mount(&server)
        .await;

    // Use a client with a short timeout so the test doesn't wait 30s.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(100))
        .build()
        .unwrap();

    let result = run_graphql_value_with_client(client, &server.uri(), "tok", "q", json!({})).await;

    match result {
        ApiResultValue::Failure { error, .. } => {
            assert!(error.contains("timed out"), "got: {error}");
        }
        other => panic!("expected Failure, got {other:?}"),
    }
}

#[tokio::test]
async fn upload_form_to_api_times_out_on_slow_server() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload"))
        // The mock outlasts any plausible client timeout, so the injected
        // short-timeout client (below) is what actually triggers the failure.
        .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(5)))
        .mount(&server)
        .await;

    // Use a client with a short timeout so the test doesn't wait the full
    // production API_REQUEST_TIMEOUT_MS. Mirrors run_graphql_value_times_out.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(100))
        .build()
        .unwrap();

    let form = Form::new().text("data", "test");
    let result = upload_form_to_api_with_client(client, &server.uri(), "tok", form).await;

    assert_eq!(result["success"], false);
    assert!(result["error"].as_str().unwrap().contains("timed out"));
}

#[tokio::test]
async fn load_asset_files_impl_returns_empty_for_not_found() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "errors": [{
                "message": "Record not found",
                "extensions": { "code": "NOT_FOUND" }
            }]
        })))
        .mount(&server)
        .await;

    let result = load_asset_files_impl(&server.uri(), "tok", "999".to_string())
        .await
        .unwrap();

    assert_eq!(result["success"], true);
    assert_eq!(result["data"], json!([]));
}

#[tokio::test]
async fn load_asset_files_impl_returns_empty_for_simfile_id_zero() {
    let result = load_asset_files_impl("https://unused.com", "tok", "0".to_string())
        .await
        .unwrap();

    assert_eq!(result["success"], true);
    assert_eq!(result["data"], json!([]));
}

#[tokio::test]
async fn load_asset_files_impl_returns_failure_for_general_graphql_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "errors": [{
                "message": "Internal server error",
                "extensions": { "code": "INTERNAL" }
            }]
        })))
        .mount(&server)
        .await;

    let result = load_asset_files_impl(&server.uri(), "tok", "42".to_string())
        .await
        .unwrap();

    assert_eq!(result["success"], false);
    assert_eq!(result["error"], "INTERNAL: Internal server error");
}

#[tokio::test]
async fn create_simfile_record_impl_surfaces_preview_upload_warnings() {
    let server = MockServer::start().await;
    // Create mutation succeeds
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {
                "createSimfile": {
                    "id": 42,
                    "title": "Song",
                    "artist": "Artist",
                    "bpm": 120.0,
                    "userId": "u1",
                    "isPublished": false,
                    "displayId": null,
                    "downloadUrl": null,
                    "previewUrl": null,
                    "videoPreviewUrl": null,
                    "publishDate": "2026-08-15",
                    "createdAt": "2026-08-15T00:00:00Z",
                    "updatedAt": "2026-08-15T00:00:01Z",
                    "dtxFiles": [],
                }
            }
        })))
        .mount(&server)
        .await;
    // Upload endpoint fails
    Mock::given(method("POST"))
        .and(path("/upload"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({
            "error": "Storage error"
        })))
        .mount(&server)
        .await;

    let workspace = tempfile::tempdir().unwrap();
    let song = workspace.path().join("mysong");
    fs::create_dir(&song).unwrap();
    fs::write(song.join("preview.jpg"), b"image").unwrap();
    fs::write(song.join("preview.mp3"), b"audio").unwrap();

    let mut simfile_data = create_input_fixture_with_display_id(None);
    simfile_data.song_path = song.to_str().unwrap().to_string();

    let result = create_simfile_record_impl(&server.uri(), "tok", simfile_data, workspace.path())
        .await
        .unwrap();
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], true);
    let warnings = result["warnings"].as_array().expect("warnings array");
    assert!(warnings.len() >= 2, "should have preview + sound warnings");
    assert!(warnings
        .iter()
        .any(|w| w.as_str().unwrap().contains("Preview image")));
    assert!(warnings
        .iter()
        .any(|w| w.as_str().unwrap().contains("Sound preview")));
}

#[tokio::test]
async fn create_simfile_record_rejects_when_managed_workspace_is_unset_before_request() {
    // Moving the root lookup below the GraphQL mutation would create a remote
    // simfile even though preview file access is not authorized.
    let server = MockServer::start().await;
    let state = WorkspaceRootState::default();

    let mut simfile_data = create_input_fixture_with_display_id(None);
    simfile_data.song_path = "/untrusted/song".to_string();
    let result =
        create_simfile_record_with_workspace_state(&server.uri(), "token-1", simfile_data, &state)
            .await;

    assert!(result.is_err());
    assert!(result
        .expect_err("managed workspace is required")
        .to_string()
        .contains("workspace root is required"));
    assert!(server
        .received_requests()
        .await
        .expect("received requests")
        .is_empty());
}

#[tokio::test]
async fn fetch_cloud_song_charts_returns_real_ids() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "simfile": { "dtxFiles": [
                { "id": "10", "label": "BASIC", "level": 5.5 },
                { "id": "11", "label": "EXTREME", "level": 8.8 }
            ] } }
        })))
        .mount(&server)
        .await;

    let result = fetch_cloud_song_charts_impl(&server.uri(), "token", serde_json::json!("42"))
        .await
        .expect("charts");

    assert_eq!(result["success"], serde_json::json!(true));
    let charts = result["data"].as_array().expect("data array");
    assert_eq!(charts.len(), 2);
    assert_eq!(charts[0]["id"], serde_json::json!("10"));
    assert_eq!(charts[0]["level"], serde_json::json!(5.5));
    assert_eq!(charts[1]["id"], serde_json::json!("11"));
}

#[tokio::test]
async fn fetch_cloud_song_charts_returns_failure_when_simfile_null() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "simfile": null }
        })))
        .mount(&server)
        .await;

    let result = fetch_cloud_song_charts_impl(&server.uri(), "token", serde_json::json!("42"))
        .await
        .expect("charts");

    assert_eq!(result["success"], serde_json::json!(false));
    assert_eq!(result["error"], serde_json::json!("Simfile not found"));
}

#[tokio::test]
async fn upload_scores_returns_result() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "uploadScores": {
                "updatedCharts": 1, "insertedScores": 3,
                "skipped": [ { "chartId": "99", "reason": "Chart not visible" } ]
            } }
        })))
        .mount(&server)
        .await;

    let payload = serde_json::json!({ "charts": [
        { "chartId": "10", "playCount": 7, "clearCount": 5, "scores": [
            { "isBest": true, "cleared": true, "fullCombo": false, "score": 950000 }
        ] }
    ] });
    let result = upload_scores_impl(&server.uri(), "token", payload)
        .await
        .expect("upload");

    assert_eq!(result["success"], serde_json::json!(true));
    assert_eq!(result["data"]["updatedCharts"], serde_json::json!(1));
    assert_eq!(result["data"]["insertedScores"], serde_json::json!(3));
    assert_eq!(
        result["data"]["skipped"][0]["chartId"],
        serde_json::json!("99")
    );
}

#[tokio::test]
async fn upload_scores_wraps_payload_as_graphql_input_variable() {
    // Pin the request body shape: upload_scores_impl must wrap the IPC
    // payload as { "variables": { "input": { "charts": [...] } } } — the
    // GraphQL mutation variable is `input`, not the bare payload. A
    // regression that drops the wrapping (e.g. sending { "variables": {
    // "charts": [...] } }) would silently send an empty/null input to the
    // server and produce confusing "no scores" skips.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(serde_json::json!({
            "variables": {
                "input": {
                    "charts": [
                        { "chartId": "10", "playCount": 7, "clearCount": 5 }
                    ]
                }
            }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "uploadScores": { "updatedCharts": 1, "insertedScores": 1, "skipped": [] } }
        })))
        .mount(&server)
        .await;

    let payload = serde_json::json!({ "charts": [
        { "chartId": "10", "playCount": 7, "clearCount": 5, "scores": [
            { "isBest": true, "cleared": true, "fullCombo": false, "score": 950000 }
        ] }
    ] });
    let result = upload_scores_impl(&server.uri(), "token", payload)
        .await
        .expect("upload");

    assert_eq!(result["success"], serde_json::json!(true));
    assert_eq!(result["data"]["updatedCharts"], serde_json::json!(1));
}

#[tokio::test]
async fn upload_scores_surfaces_graphql_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [ { "message": "Not authenticated", "extensions": { "code": "FORBIDDEN" } } ]
        })))
        .mount(&server)
        .await;

    let result = upload_scores_impl(&server.uri(), "token", serde_json::json!({ "charts": [] }))
        .await
        .expect("upload");

    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("Not authenticated"));
}

#[tokio::test]
async fn upload_scores_rejects_payload_missing_charts_array() {
    // No mock server needed — validation short-circuits before the network call.
    let result = upload_scores_impl("http://unused", "token", serde_json::json!({}))
        .await
        .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("missing 'charts'"));
}

#[tokio::test]
async fn upload_scores_rejects_payload_with_non_array_charts() {
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": "not-an-array" }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("missing 'charts'"));
}

#[tokio::test]
async fn upload_scores_rejects_chart_missing_chart_id() {
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": [
            { "playCount": 1, "clearCount": 0, "scores": [] }
        ] }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"].as_str().unwrap().contains("chartId"));
}

#[tokio::test]
async fn upload_scores_rejects_negative_play_count() {
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": [
            { "chartId": "10", "playCount": -1, "clearCount": 0, "scores": [] }
        ] }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"].as_str().unwrap().contains("non-negative"));
}

#[tokio::test]
async fn upload_scores_rejects_chart_missing_scores_array() {
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": [
            { "chartId": "10", "playCount": 1, "clearCount": 0 }
        ] }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"].as_str().unwrap().contains("scores"));
}

#[tokio::test]
async fn upload_scores_rejects_chart_with_excessive_scores() {
    // 1001 score entries on a single chart exceeds the IPC sanity cap
    // (IPC_MAX_SCORES_PER_CHART). No mock needed.
    let scores: Vec<serde_json::Value> = (0..1001)
        .map(|_| {
            serde_json::json!({
                "score": 800000,
                "isBest": 0,
                "cleared": 1,
                "fullCombo": 0
            })
        })
        .collect();
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": [
            { "chartId": "10", "playCount": 1, "clearCount": 0, "scores": scores }
        ] }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("too many scores"));
}

#[tokio::test]
async fn upload_scores_rejects_excessive_chart_count() {
    // 1001 charts exceeds the IPC sanity cap (1000). No mock needed.
    let charts: Vec<serde_json::Value> = (0..1001)
        .map(|i| {
            serde_json::json!({
                "chartId": i.to_string(),
                "playCount": 1,
                "clearCount": 0,
                "scores": []
            })
        })
        .collect();
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": charts }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("too many charts"));
}

#[tokio::test]
async fn upload_scores_rejects_chart_id_with_invalid_type() {
    // chartId must be a string or number. A boolean is neither, so the
    // defense-in-depth guard rejects it before the network round-trip.
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": [
            { "chartId": true, "playCount": 1, "clearCount": 0, "scores": [] }
        ] }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("chartId' must be a string or number"));
}

#[tokio::test]
async fn upload_scores_rejects_chart_missing_play_count() {
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": [
            { "chartId": "10", "clearCount": 0, "scores": [] }
        ] }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("missing 'playCount'"));
}

#[tokio::test]
async fn upload_scores_rejects_non_integer_play_count() {
    // A non-numeric string can't be parsed as an integer.
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": [
            { "chartId": "10", "playCount": "abc", "clearCount": 0, "scores": [] }
        ] }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("playCount' must be an integer"));
}

#[tokio::test]
async fn upload_scores_rejects_negative_clear_count() {
    // The negative-check runs for both playCount and clearCount. playCount=0
    // passes, so the loop reaches clearCount=-1 and rejects it — covering
    // the clearCount half of the non-negative guard.
    let result = upload_scores_impl(
        "http://unused",
        "token",
        serde_json::json!({ "charts": [
            { "chartId": "10", "playCount": 0, "clearCount": -1, "scores": [] }
        ] }),
    )
    .await
    .expect("upload");
    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("clearCount' must be non-negative"));
}

#[tokio::test]
async fn fetch_cloud_song_charts_returns_empty_when_dtx_files_absent() {
    // A simfile whose `dtxFiles` field is missing or non-array degrades to an
    // empty chart list (success, not an error) rather than aborting the parse.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "simfile": {} }
        })))
        .mount(&server)
        .await;

    let result = fetch_cloud_song_charts_impl(&server.uri(), "token", serde_json::json!("42"))
        .await
        .expect("charts");

    assert_eq!(result["success"], serde_json::json!(true));
    assert_eq!(result["data"], serde_json::json!([]));
}

// ---------------------------------------------------------------------------
// classify_metadata_auth_error — maps DesktopError messages to the
// coarse-grained DriveMetadataError categories reconciliation acts on.
// ---------------------------------------------------------------------------

#[test]
fn classify_metadata_auth_error_maps_network_messages_to_network() {
    for message in [
        "Network error: connection refused",
        "Request timed out after 30000ms",
        "timeout contacting auth server",
    ] {
        assert_eq!(
            classify_metadata_auth_error(DesktopError::Message(message.to_string())),
            crate::google_drive::DriveMetadataError::Network,
            "expected Network for message: {message}"
        );
    }
}

#[test]
fn classify_metadata_auth_error_maps_other_messages_to_authentication() {
    // A non-network failure (e.g. a missing session) is an auth problem, not a
    // transient outage — collapsing it into Network would let reconciliation
    // retry forever instead of prompting re-authentication.
    assert_eq!(
        classify_metadata_auth_error(DesktopError::Message("No active session".to_string())),
        crate::google_drive::DriveMetadataError::Authentication
    );
}

// ---------------------------------------------------------------------------
// search_cloud_songs_impl — exclude_ids coercion of non-string values.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn search_cloud_songs_impl_coerces_numeric_exclude_ids_to_strings() {
    // The renderer may send exclude ids as numbers; the GraphQL variable is
    // [ID!] (strings), so numeric ids must be stringified rather than dropped.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(serde_json::json!({
            "variables": {
                "query": "Song",
                "limit": 8,
                "excludeIds": ["1", "2"]
            }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "simfileSearch": [] }
        })))
        .mount(&server)
        .await;

    let result = search_cloud_songs_impl(
        &server.uri(),
        "token-1",
        "Song".to_string(),
        None,
        Some(vec![serde_json::json!(1), serde_json::json!(2)]),
    )
    .await
    .expect("result");

    assert_eq!(result["success"], serde_json::json!(true));
}

// ---------------------------------------------------------------------------
// update_drive_file_impl — null mutation response.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn update_drive_file_impl_returns_definitive_unavailable_for_null_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "updateSimfileDriveFileGuarded": null }
        })))
        .mount(&server)
        .await;

    let error = update_drive_file_impl(
        &server.uri(),
        "token-1",
        "42",
        "drive-file-42",
        "https://drive.google.com/uc?id=drive-file-42",
        "user-1",
        None,
    )
    .await
    .expect_err("null mutation response is definitive loss");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::DefinitiveUnavailable
    );
}

// ---------------------------------------------------------------------------
// fetch_cloud_song_impl / fetch_cloud_song_charts_impl — GraphQL error branch.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn fetch_cloud_song_impl_returns_failure_on_graphql_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [{ "message": "forbidden", "extensions": { "code": "FORBIDDEN" } }]
        })))
        .mount(&server)
        .await;

    let result = fetch_cloud_song_impl(&server.uri(), "token-1", "42".to_string())
        .await
        .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"].as_str().unwrap().contains("forbidden"));
}

#[tokio::test]
async fn fetch_cloud_song_charts_impl_returns_failure_on_graphql_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [{ "message": "forbidden", "extensions": { "code": "FORBIDDEN" } }]
        })))
        .mount(&server)
        .await;

    let result = fetch_cloud_song_charts_impl(&server.uri(), "token-1", serde_json::json!("42"))
        .await
        .expect("result");

    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"].as_str().unwrap().contains("forbidden"));
}

// ---------------------------------------------------------------------------
// drive_metadata_graphql_data error-code classification (via
// fetch_owner_drive_simfile_impl). Each GraphQL error code maps to a
// coarse-grained category so reconciliation never deletes a recoverable
// Drive object.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn drive_metadata_classifies_not_found_code_as_definitive_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [{ "message": "not found", "extensions": { "code": "NOT_FOUND" } }]
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("NOT_FOUND is definitive loss");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::DefinitiveUnavailable
    );
}

#[tokio::test]
async fn drive_metadata_classifies_binding_mismatch_code_as_binding_mismatch() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [{
                "message": "Simfile Drive binding changed since the expected previous value",
                "extensions": { "code": "DRIVE_BINDING_MISMATCH" }
            }]
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("DRIVE_BINDING_MISMATCH is a guard failure, not deletion");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::BindingMismatch
    );
}

#[tokio::test]
async fn drive_metadata_classifies_internal_server_error_code_as_service_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [{
                "message": "boom",
                "extensions": { "code": "INTERNAL_SERVER_ERROR" }
            }]
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("INTERNAL_SERVER_ERROR is transient");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::ServiceUnavailable
    );
}

#[tokio::test]
async fn drive_metadata_classifies_service_unavailable_code_as_service_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [{
                "message": "down",
                "extensions": { "code": "SERVICE_UNAVAILABLE" }
            }]
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("SERVICE_UNAVAILABLE is transient");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::ServiceUnavailable
    );
}

#[tokio::test]
async fn drive_metadata_classifies_unauthenticated_code_as_authentication() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [{
                "message": "log in",
                "extensions": { "code": "UNAUTHENTICATED" }
            }]
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("UNAUTHENTICATED requires re-auth");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::Authentication
    );
}

#[tokio::test]
async fn drive_metadata_classifies_unknown_error_code_as_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [{
                "message": "weird",
                "extensions": { "code": "SOMETHING_UNEXPECTED" }
            }]
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("unknown code is malformed, not absence");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::InvalidResponse
    );
}

#[tokio::test]
async fn drive_metadata_classifies_4xx_non_auth_status_as_invalid_response() {
    // A 404/422 is neither an auth failure (401/403) nor a server outage
    // (5xx); it surfaces as InvalidResponse so reconciliation leaves the
    // Drive object intact rather than claiming absence.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "error": "not found"
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("4xx non-auth is invalid response");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::InvalidResponse
    );
}

#[tokio::test]
async fn drive_metadata_classifies_403_status_as_authentication() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(403).set_body_json(serde_json::json!({
            "error": "forbidden"
        })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("403 is auth failure");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::Authentication
    );
}

// ---------------------------------------------------------------------------
// upload_bytes_to_api — invalid content-type short-circuits before the POST.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn upload_bytes_to_api_returns_failure_for_invalid_content_type() {
    // A malformed MIME string (containing a space) is rejected by
    // Part::mime_str before any network call. No mock server is consulted.
    let result = upload_bytes_to_api(
        "https://unused.example.com",
        "token-1",
        b"bytes".to_vec(),
        "preview.jpg",
        "42",
        Some("not a valid mime"),
    )
    .await;

    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"].as_str().is_some_and(|e| !e.is_empty()));
}

// ---------------------------------------------------------------------------
// upload_name_from_file_name — trailing-slash fallback.
// ---------------------------------------------------------------------------

#[test]
fn upload_name_from_file_name_falls_back_when_stripped_segment_is_empty() {
    // "song/" splits to ["song", ""] → stripped is "" → fall back to the
    // original so we don't upload under an empty name.
    assert_eq!(upload_name_from_file_name("song/"), "song/");
}

// ---------------------------------------------------------------------------
// create_simfile_record_impl — GraphQL error branch.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn create_simfile_record_impl_returns_failure_on_graphql_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [{ "message": "forbidden", "extensions": { "code": "FORBIDDEN" } }]
        })))
        .mount(&server)
        .await;

    let workspace = tempfile::tempdir().expect("workspace");
    let result = create_simfile_record_impl(
        &server.uri(),
        "token-1",
        create_input_fixture_with_display_id(None),
        workspace.path(),
    )
    .await
    .expect("result");
    let result = serde_json::to_value(result).expect("serializes");

    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"].as_str().unwrap().contains("forbidden"));
}

// ---------------------------------------------------------------------------
// update_drive_file_impl — ExpectedPreviousDriveFile variants (patch lines
// 529-533). Each variant must serialize the correct optimistic-concurrency
// variables so the server can reject stale cross-device overwrites.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn update_drive_file_impl_sends_expect_no_existing_drive_file_for_none_variant() {
    // ExpectedPreviousDriveFile::None → expectNoExistingDriveFile: true,
    // expectedPreviousDriveFileId: null. This guards FirstUpload against
    // racing with another device that already bound a Drive file.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(serde_json::json!({
            "variables": {
                "expectNoExistingDriveFile": true,
                "expectedPreviousDriveFileId": null
            }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "updateSimfileDriveFileGuarded": owner_drive_simfile() }
        })))
        .mount(&server)
        .await;

    let result = update_drive_file_impl(
        &server.uri(),
        "token-1",
        "42",
        "drive-file-42",
        "https://drive.google.com/uc?id=drive-file-42",
        "user-1",
        Some(&ExpectedPreviousDriveFile::None),
    )
    .await
    .expect("updated drive metadata");

    assert_eq!(result.id, "42");

    let requests = server.received_requests().await.expect("received request");
    assert_eq!(requests.len(), 1);
    let body: Value = serde_json::from_slice(&requests[0].body).expect("GraphQL JSON body");
    assert_eq!(body["variables"]["expectNoExistingDriveFile"], true);
    assert!(body["variables"]["expectedPreviousDriveFileId"].is_null());
}

#[tokio::test]
async fn update_drive_file_impl_sends_expected_previous_drive_file_id_for_drive_file_variant() {
    // ExpectedPreviousDriveFile::DriveFile("prev-id") →
    // expectedPreviousDriveFileId: "prev-id", expectNoExistingDriveFile: null.
    // This guards ExplicitReplacement against overwriting a newer binding.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(serde_json::json!({
            "variables": {
                "expectedPreviousDriveFileId": "prev-drive-file",
                "expectNoExistingDriveFile": null
            }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "updateSimfileDriveFileGuarded": owner_drive_simfile() }
        })))
        .mount(&server)
        .await;

    let result = update_drive_file_impl(
        &server.uri(),
        "token-1",
        "42",
        "drive-file-42",
        "https://drive.google.com/uc?id=drive-file-42",
        "user-1",
        Some(&ExpectedPreviousDriveFile::DriveFile(
            "prev-drive-file".to_string(),
        )),
    )
    .await
    .expect("updated drive metadata");

    assert_eq!(result.id, "42");

    let requests = server.received_requests().await.expect("received request");
    assert_eq!(requests.len(), 1);
    let body: Value = serde_json::from_slice(&requests[0].body).expect("GraphQL JSON body");
    assert_eq!(
        body["variables"]["expectedPreviousDriveFileId"],
        "prev-drive-file"
    );
    assert!(body["variables"]["expectNoExistingDriveFile"].is_null());
}

// ---------------------------------------------------------------------------
// read_preview_within_workspace — "Song folder not found" error path (patch
// line 934). When the workspace root exists but the song folder does not,
// the refactored containment check surfaces a clear NotFound message rather
// than a generic I/O error.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn read_preview_within_workspace_rejects_nonexistent_song_folder() {
    let workspace = tempfile::tempdir().expect("workspace");

    // The nonexistent song folder must have an existing ancestor inside the
    // workspace so the containment check passes and surfaces NotFound for the
    // missing target itself (rather than rejecting it as outside the workspace).
    let result = read_preview_within_workspace(
        &format!(
            "{}/nonexistent-song-folder-12345",
            workspace.path().to_str().unwrap()
        ),
        workspace.path().to_str().unwrap(),
        "preview.jpg",
    )
    .await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Song folder not found"));
}

// ---------------------------------------------------------------------------
// drive_metadata_graphql_data — HTTP status classification branches.
// `fetch_owner_drive_simfile_impl` routes through `drive_metadata_graphql_data`,
// so these tests exercise the status-code branches indirectly (as the
// production callers do) rather than touching the private helper directly.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn drive_metadata_classifies_429_status_as_service_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(429).set_body_json(json!({ "error": "rate limited" })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("429 should be service unavailable");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::ServiceUnavailable
    );
}

#[tokio::test]
async fn drive_metadata_classifies_408_status_as_service_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(
            ResponseTemplate::new(408).set_body_json(json!({ "error": "request timeout" })),
        )
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("408 should be service unavailable");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::ServiceUnavailable
    );
}

#[tokio::test]
async fn drive_metadata_classifies_400_status_as_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({ "error": "bad request" })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("400 should be invalid response");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::InvalidResponse
    );
}

#[tokio::test]
async fn drive_metadata_classifies_404_status_as_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "not found" })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("404 should be invalid response");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::InvalidResponse
    );
}

#[tokio::test]
async fn drive_metadata_classifies_422_status_as_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({ "error": "unprocessable" })))
        .mount(&server)
        .await;

    let error = fetch_owner_drive_simfile_impl(&server.uri(), "token-1", "42", "user-1")
        .await
        .expect_err("422 should be invalid response");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::InvalidResponse
    );
}

// ---------------------------------------------------------------------------
// authenticated_user_id — derives the Drumery user id from the native
// AuthState session. It must surface an Authentication error whenever the
// session is missing, lacks a user id, or carries a blank id, so that Drive
// commands never operate on an unauthenticated identity.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn authenticated_user_id_errors_when_session_is_absent() {
    let state = AuthState::default();

    let error = authenticated_user_id(&state)
        .await
        .expect_err("missing session is unauthenticated");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::Authentication
    );
}

#[tokio::test]
async fn authenticated_user_id_errors_when_session_lacks_user_id() {
    let state = AuthState::default();
    state
        .set_current_session(Some(json!({ "access_token": "tok-1" })))
        .await;

    let error = authenticated_user_id(&state)
        .await
        .expect_err("session without user.id is unauthenticated");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::Authentication
    );
}

#[tokio::test]
async fn authenticated_user_id_errors_when_user_id_is_empty() {
    let state = AuthState::default();
    state
        .set_current_session(Some(json!({
            "access_token": "tok-1",
            "user": { "id": "" }
        })))
        .await;

    let error = authenticated_user_id(&state)
        .await
        .expect_err("blank user id is unauthenticated");

    assert_eq!(
        error,
        crate::google_drive::DriveMetadataError::Authentication
    );
}
