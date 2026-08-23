use super::*;
use crate::api_contracts::CreateSimfileLevelInput;
use crate::workspace::{test_support::managed_workspace_state, WorkspaceRootState};
use std::fs;
use ts_rs::TS;
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

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

#[test]
fn number_id_accepts_i64_and_numeric_strings_but_rejects_overflow_and_invalid_types() {
    assert_eq!(number_id(&json!(42)).unwrap(), 42);
    assert_eq!(number_id(&json!(-7)).unwrap(), -7);
    assert_eq!(number_id(&json!("123")).unwrap(), 123);
    assert_eq!(
        number_id(&json!(9_223_372_036_854_775_807u64)).unwrap(),
        i64::MAX
    );
    assert!(number_id(&json!(u64::MAX)).is_err());
    assert!(number_id(&json!(null)).is_err());
    assert!(number_id(&json!([1, 2])).is_err());
    assert!(number_id(&json!("not a number")).is_err());
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

// ---------------------------------------------------------------------------
// fetch_cloud_song_impl — GraphQL error branch.
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
