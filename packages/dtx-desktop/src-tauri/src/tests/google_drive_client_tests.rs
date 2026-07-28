use super::*;
use serde_json::json;
use std::time::{Duration, SystemTime};
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const ACCESS_TOKEN: &str = "drive-access-token";
const FOLDER_FIELDS: &str = "id,name,mimeType,trashed,capabilities(canAddChildren)";
const PERMISSION_FIELDS: &str = "permissions(id,type,role,view,allowFileDiscovery),nextPageToken";

fn client(server: &MockServer) -> GoogleDriveClient {
    GoogleDriveClient::with_base_url(format!("{}/drive/v3", server.uri()))
        .expect("test Drive client")
}

async fn mount_valid_folder(server: &MockServer, folder_id: &str) {
    Mock::given(method("GET"))
        .and(path(format!("/drive/v3/files/{folder_id}")))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(query_param("supportsAllDrives", "true"))
        .and(query_param("fields", FOLDER_FIELDS))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": folder_id,
            "name": "Public uploads",
            "mimeType": "application/vnd.google-apps.folder",
            "trashed": false,
            "capabilities": {
                "canAddChildren": true
            }
        })))
        .mount(server)
        .await;
}

async fn mount_public_permissions(server: &MockServer, item_id: &str) {
    Mock::given(method("GET"))
        .and(path(format!("/drive/v3/files/{item_id}/permissions")))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(query_param("supportsAllDrives", "true"))
        .and(query_param("fields", PERMISSION_FIELDS))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "permissions": [{
                "id": "permission-public",
                "type": "anyone",
                "role": "reader",
                "view": null,
                "allowFileDiscovery": false
            }]
        })))
        .mount(server)
        .await;
}

#[tokio::test]
async fn folder_validation_requests_nested_capability_fields_and_accepts_public_reader() {
    let server = MockServer::start().await;
    mount_valid_folder(&server, "folder-42").await;
    mount_public_permissions(&server, "folder-42").await;

    assert_eq!(
        client(&server)
            .validate_folder(ACCESS_TOKEN, "folder-42")
            .await,
        Ok(ValidatedFolder {
            id: "folder-42".to_string(),
            name: "Public uploads".to_string(),
        })
    );
}

#[tokio::test]
async fn folder_validation_rejects_non_folder_trashed_or_non_writable_items() {
    for (name, response) in [
        (
            "non-folder",
            json!({
                "id": "folder-42",
                "name": "Not a folder",
                "mimeType": "application/zip",
                "trashed": false,
                "capabilities": { "canAddChildren": false }
            }),
        ),
        (
            "trashed",
            json!({
                "id": "folder-42",
                "name": "Trashed",
                "mimeType": "application/vnd.google-apps.folder",
                "trashed": true,
                "capabilities": { "canAddChildren": true }
            }),
        ),
        (
            "cannot add children",
            json!({
                "id": "folder-42",
                "name": "Read only",
                "mimeType": "application/vnd.google-apps.folder",
                "trashed": false,
                "capabilities": { "canAddChildren": false }
            }),
        ),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/folder-42"))
            .respond_with(ResponseTemplate::new(200).set_body_json(response))
            .mount(&server)
            .await;

        assert_eq!(
            client(&server)
                .validate_folder(ACCESS_TOKEN, "folder-42")
                .await,
            Err(GoogleDriveValidationError::FolderUnavailable),
            "{name}"
        );
    }
}

#[tokio::test]
async fn folder_validation_fails_closed_when_trashed_state_is_missing() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/folder-42"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "folder-42",
            "name": "Ambiguous folder",
            "mimeType": "application/vnd.google-apps.folder",
            "capabilities": { "canAddChildren": true }
        })))
        .mount(&server)
        .await;
    mount_public_permissions(&server, "folder-42").await;

    assert_eq!(
        client(&server)
            .validate_folder(ACCESS_TOKEN, "folder-42")
            .await,
        Err(GoogleDriveValidationError::FolderUnavailable)
    );
}

#[tokio::test]
async fn permission_validation_paginates_and_accepts_public_commenter_or_writer() {
    for role in ["commenter", "writer"] {
        let server = MockServer::start().await;
        mount_valid_folder(&server, "folder-42").await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/folder-42/permissions"))
            .and(query_param("supportsAllDrives", "true"))
            .and(query_param("fields", PERMISSION_FIELDS))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "permissions": [{
                    "id": "permission-domain",
                    "type": "domain",
                    "role": "reader",
                    "view": null,
                    "allowFileDiscovery": true
                }],
                "nextPageToken": "page-2"
            })))
            .with_priority(2)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/folder-42/permissions"))
            .and(query_param("supportsAllDrives", "true"))
            .and(query_param("fields", PERMISSION_FIELDS))
            .and(query_param("pageToken", "page-2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "permissions": [{
                    "id": "permission-anyone",
                    "type": "anyone",
                    "role": role,
                    "view": null,
                    "allowFileDiscovery": false
                }]
            })))
            .with_priority(1)
            .mount(&server)
            .await;

        assert_eq!(
            client(&server)
                .validate_folder(ACCESS_TOKEN, "folder-42")
                .await
                .map(|_| ()),
            Ok(()),
            "{role}"
        );
    }
}

#[tokio::test]
async fn permission_pagination_preserves_opaque_page_token_byte_for_byte() {
    let server = MockServer::start().await;
    let opaque_token = "  opaque +/== token  ";
    mount_valid_folder(&server, "folder-42").await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/folder-42/permissions"))
        .and(query_param("supportsAllDrives", "true"))
        .and(query_param("fields", PERMISSION_FIELDS))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "permissions": [],
            "nextPageToken": opaque_token
        })))
        .with_priority(2)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/folder-42/permissions"))
        .and(query_param("supportsAllDrives", "true"))
        .and(query_param("fields", PERMISSION_FIELDS))
        .and(query_param("pageToken", opaque_token))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "permissions": [{
                "id": "permission-anyone",
                "type": "anyone",
                "role": "reader",
                "view": null,
                "allowFileDiscovery": false
            }]
        })))
        .with_priority(1)
        .expect(1)
        .mount(&server)
        .await;

    assert_eq!(
        client(&server)
            .validate_folder(ACCESS_TOKEN, "folder-42")
            .await
            .map(|_| ()),
        Ok(())
    );
}

#[tokio::test]
async fn ambiguous_page_tokens_fail_as_sharing_check_unavailable() {
    let oversized_token = "x".repeat(8 * 1024 + 1);
    for (name, token) in [
        ("empty", String::new()),
        ("whitespace", " \t\r\n ".to_string()),
        ("oversized", oversized_token),
    ] {
        let server = MockServer::start().await;
        mount_valid_folder(&server, "folder-42").await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/folder-42/permissions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "permissions": [],
                "nextPageToken": token
            })))
            .mount(&server)
            .await;

        assert_eq!(
            client(&server)
                .validate_folder(ACCESS_TOKEN, "folder-42")
                .await,
            Err(GoogleDriveValidationError::SharingCheckUnavailable),
            "{name}"
        );
    }
}

#[tokio::test]
async fn permission_validation_rejects_non_anonymous_restricted_or_non_read_roles() {
    for (name, permission) in [
        (
            "domain",
            json!({"id":"p","type":"domain","role":"reader","view":null,"allowFileDiscovery":true}),
        ),
        (
            "group",
            json!({"id":"p","type":"group","role":"reader","view":null,"allowFileDiscovery":false}),
        ),
        (
            "named user",
            json!({"id":"p","type":"user","role":"reader","view":null,"allowFileDiscovery":false}),
        ),
        (
            "target audience",
            json!({"id":"p","type":"domain","role":"reader","view":"metadata","allowFileDiscovery":false}),
        ),
        (
            "restricted view",
            json!({"id":"p","type":"anyone","role":"reader","view":"metadata","allowFileDiscovery":false}),
        ),
        (
            "empty populated view",
            json!({"id":"p","type":"anyone","role":"reader","view":"","allowFileDiscovery":false}),
        ),
        (
            "whitespace populated view",
            json!({"id":"p","type":"anyone","role":"reader","view":" \t ","allowFileDiscovery":false}),
        ),
        (
            "unknown populated view",
            json!({"id":"p","type":"anyone","role":"reader","view":"future-provider-value","allowFileDiscovery":false}),
        ),
        (
            "non-read role",
            json!({"id":"p","type":"anyone","role":"owner","view":null,"allowFileDiscovery":false}),
        ),
    ] {
        let server = MockServer::start().await;
        mount_valid_folder(&server, "folder-42").await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/folder-42/permissions"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({ "permissions": [permission] })),
            )
            .mount(&server)
            .await;

        assert_eq!(
            client(&server)
                .validate_folder(ACCESS_TOKEN, "folder-42")
                .await,
            Err(GoogleDriveValidationError::DownloadNotPublic),
            "{name}"
        );
    }

    let server = MockServer::start().await;
    mount_valid_folder(&server, "folder-42").await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/folder-42/permissions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "permissions": [] })))
        .mount(&server)
        .await;
    assert_eq!(
        client(&server)
            .validate_folder(ACCESS_TOKEN, "folder-42")
            .await,
        Err(GoogleDriveValidationError::DownloadNotPublic)
    );
}

#[tokio::test]
async fn permission_403_is_check_unavailable_never_private() {
    let server = MockServer::start().await;
    mount_valid_folder(&server, "folder-42").await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/folder-42/permissions"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({
            "error": { "message": "raw provider detail must not escape" }
        })))
        .mount(&server)
        .await;

    assert_eq!(
        client(&server)
            .validate_folder(ACCESS_TOKEN, "folder-42")
            .await,
        Err(GoogleDriveValidationError::SharingCheckUnavailable)
    );
}

#[tokio::test]
async fn missing_or_inaccessible_folder_is_folder_unavailable() {
    for status in [404, 403] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/missing-folder"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;

        assert_eq!(
            client(&server)
                .validate_folder(ACCESS_TOKEN, "missing-folder")
                .await,
            Err(GoogleDriveValidationError::FolderUnavailable),
            "{status}"
        );
    }
}

#[tokio::test]
async fn existing_file_distinguishes_not_found_from_permission_denied() {
    for (status, expected) in [
        (404, GoogleDriveValidationError::FileNotFound),
        (403, GoogleDriveValidationError::FilePermissionDenied),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/existing-file"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;

        assert_eq!(
            client(&server)
                .validate_file_before_update(ACCESS_TOKEN, "existing-file")
                .await,
            Err(expected)
        );
    }
}

#[tokio::test]
async fn existing_file_validation_fails_closed_when_trashed_state_is_missing() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/existing-file"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "existing-file"
        })))
        .mount(&server)
        .await;
    mount_public_permissions(&server, "existing-file").await;

    assert_eq!(
        client(&server)
            .validate_file_before_update(ACCESS_TOKEN, "existing-file")
            .await,
        Err(GoogleDriveValidationError::InvalidResponse)
    );
}

#[tokio::test]
async fn create_and_update_validation_rechecks_drive_instead_of_trusting_prior_success() {
    let folder_server = MockServer::start().await;
    mount_valid_folder(&folder_server, "folder-42").await;
    mount_public_permissions(&folder_server, "folder-42").await;
    let folder_client = client(&folder_server);

    folder_client
        .validate_folder_before_create(ACCESS_TOKEN, "folder-42")
        .await
        .expect("first folder check");
    folder_client
        .validate_folder_before_create(ACCESS_TOKEN, "folder-42")
        .await
        .expect("second folder check");

    let folder_requests = folder_server
        .received_requests()
        .await
        .expect("folder requests");
    assert_eq!(
        folder_requests
            .iter()
            .filter(|request| request.url.path() == "/drive/v3/files/folder-42")
            .count(),
        2
    );

    let file_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/existing-file"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "existing-file",
            "trashed": false
        })))
        .mount(&file_server)
        .await;
    mount_public_permissions(&file_server, "existing-file").await;
    let file_client = client(&file_server);

    file_client
        .validate_file_before_update(ACCESS_TOKEN, "existing-file")
        .await
        .expect("first file check");
    file_client
        .validate_file_before_update(ACCESS_TOKEN, "existing-file")
        .await
        .expect("second file check");

    let file_requests = file_server
        .received_requests()
        .await
        .expect("file requests");
    assert_eq!(
        file_requests
            .iter()
            .filter(|request| request.url.path() == "/drive/v3/files/existing-file")
            .count(),
        2
    );
    assert!(
        file_requests
            .iter()
            .all(|request| request.method.as_str() == "GET"),
        "validation must never mutate Drive permissions"
    );
}

#[tokio::test]
async fn resumable_generate_id_requests_one_drive_file_id_and_rejects_ambiguous_responses() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/generateIds"))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(query_param("count", "1"))
        .and(query_param("space", "drive"))
        .and(query_param("type", "files"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "ids": ["generated-file-id"],
            "space": "drive",
            "kind": "drive#generatedIds"
        })))
        .mount(&server)
        .await;

    assert_eq!(
        client(&server).generate_id(ACCESS_TOKEN).await,
        Ok("generated-file-id".to_string())
    );

    for ids in [
        json!([]),
        json!(["first", "second"]),
        json!([" \t "]),
        json!([42]),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/generateIds"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ids": ids })))
            .mount(&server)
            .await;

        assert_eq!(
            client(&server).generate_id(ACCESS_TOKEN).await,
            Err(GoogleDriveValidationError::InvalidResponse)
        );
    }
}

#[tokio::test]
async fn resumable_create_uses_generated_id_parent_zip_metadata_and_session_location() {
    let server = MockServer::start().await;
    let session_url = format!("{}/upload-session/create", server.uri());
    Mock::given(method("POST"))
        .and(path("/upload/drive/v3/files"))
        .and(query_param("uploadType", "resumable"))
        .and(query_param("supportsAllDrives", "true"))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(header("x-upload-content-type", "application/zip"))
        .and(header("x-upload-content-length", "7"))
        .and(body_json(json!({
            "id": "generated-file-id",
            "name": "AC-DC.zip",
            "mimeType": "application/zip",
            "parents": ["folder-42"]
        })))
        .respond_with(ResponseTemplate::new(200).insert_header("location", session_url.as_str()))
        .mount(&server)
        .await;

    let session = client(&server)
        .start_resumable_create(
            ACCESS_TOKEN,
            &DriveCreateMetadata {
                id: "generated-file-id".to_string(),
                parent_id: "folder-42".to_string(),
                name: "AC-DC.zip".to_string(),
            },
            7,
        )
        .await
        .expect("create session");

    assert_eq!(session.as_str(), session_url);
}

#[tokio::test]
async fn resumable_create_classifies_a_definitive_invalid_generated_id_without_reclassifying_updates(
) {
    // Break caught: treating the create-specific invalid-ID response as a
    // generic error (so reconciliation cannot perform its required 404 probe),
    // or applying the rotation signal to an existing-file update.
    let create_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload/drive/v3/files"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": {
                "errors": [{ "reason": "invalidArgument" }]
            }
        })))
        .mount(&create_server)
        .await;
    let create_metadata = DriveCreateMetadata {
        id: "expired-generated-id".to_string(),
        parent_id: "folder-42".to_string(),
        name: "Song.zip".to_string(),
    };
    assert_eq!(
        GoogleDriveApi::start_resumable_create(
            &client(&create_server),
            ACCESS_TOKEN,
            &create_metadata,
            3,
        )
        .await
        .expect_err("definitive invalid generated ID"),
        DriveApiError::InvalidGeneratedId
    );

    let update_server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/upload/drive/v3/files/existing-file"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": {
                "errors": [{ "reason": "invalidArgument" }]
            }
        })))
        .mount(&update_server)
        .await;
    assert_eq!(
        GoogleDriveApi::start_resumable_update(
            &client(&update_server),
            ACCESS_TOKEN,
            "existing-file",
            &DriveUpdateMetadata {
                name: "Song.zip".to_string()
            },
            3,
        )
        .await
        .expect_err("update error"),
        DriveApiError::InvalidResponse
    );
}

#[tokio::test]
async fn resumable_update_renames_existing_file_without_parent_mutation() {
    let server = MockServer::start().await;
    let session_url = format!("{}/upload-session/update", server.uri());
    Mock::given(method("PATCH"))
        .and(path("/upload/drive/v3/files/existing-file"))
        .and(query_param("uploadType", "resumable"))
        .and(query_param("supportsAllDrives", "true"))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(header("x-upload-content-type", "application/zip"))
        .and(header("x-upload-content-length", "11"))
        .and(body_json(json!({
            "name": "Song: Reprise.zip",
            "mimeType": "application/zip"
        })))
        .respond_with(ResponseTemplate::new(200).insert_header("location", session_url.as_str()))
        .mount(&server)
        .await;

    let session = client(&server)
        .start_resumable_update(
            ACCESS_TOKEN,
            "existing-file",
            &DriveUpdateMetadata {
                name: "Song: Reprise.zip".to_string(),
            },
            11,
        )
        .await
        .expect("update session");

    assert_eq!(session.as_str(), session_url);
    let request = server
        .received_requests()
        .await
        .expect("requests")
        .into_iter()
        .next()
        .expect("update request");
    assert!(
        !request
            .url
            .query_pairs()
            .any(|(key, _)| matches!(key.as_ref(), "addParents" | "removeParents")),
        "replacement must not move the existing file"
    );
}

#[tokio::test]
async fn resumable_chunks_use_put_and_authoritative_range_then_probe_with_empty_put() {
    let server = MockServer::start().await;
    let session =
        ResumableUploadSession::for_test(&format!("{}/session-42", server.uri())).expect("session");
    Mock::given(method("PUT"))
        .and(path("/session-42"))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(header("content-length", "4"))
        .and(header("content-range", "bytes 0-3/10"))
        .respond_with(ResponseTemplate::new(308).insert_header("range", "bytes=0-3"))
        .expect(1)
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::upload_chunk(&client(&server), ACCESS_TOKEN, &session, 0, b"0123", 10,)
            .await,
        Ok(DriveChunkResult::Accepted(4))
    );

    Mock::given(method("PUT"))
        .and(path("/session-42"))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(header("content-length", "0"))
        .and(header("content-range", "bytes */10"))
        .respond_with(ResponseTemplate::new(308).insert_header("range", "bytes=0-5"))
        .expect(1)
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::query_session_status(&client(&server), ACCESS_TOKEN, &session, 10).await,
        Ok(DriveChunkResult::Accepted(6))
    );
}

#[tokio::test]
async fn resumable_status_probe_maps_a_404_to_session_expired() {
    let server = MockServer::start().await;
    let session =
        ResumableUploadSession::for_test(&format!("{}/session", server.uri())).expect("session");
    Mock::given(method("PUT"))
        .and(path("/session"))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(header("content-length", "0"))
        .and(header("content-range", "bytes */10"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::query_session_status(&client(&server), ACCESS_TOKEN, &session, 10).await,
        Err(DriveApiError::SessionExpired)
    );
}

#[tokio::test]
async fn resumable_308_without_range_confirms_zero_bytes_not_the_attempted_chunk() {
    let server = MockServer::start().await;
    let session =
        ResumableUploadSession::for_test(&format!("{}/session", server.uri())).expect("session");
    Mock::given(method("PUT"))
        .and(path("/session"))
        .respond_with(ResponseTemplate::new(308))
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::upload_chunk(&client(&server), ACCESS_TOKEN, &session, 0, b"0123", 8).await,
        Ok(DriveChunkResult::Accepted(0))
    );
}

#[tokio::test]
async fn resumable_final_get_requests_exact_fields_and_preserves_original_link() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/generated-file-id"))
        .and(query_param("supportsAllDrives", "true"))
        .and(query_param(
            "fields",
            "id,name,mimeType,webContentLink,capabilities(canDownload)",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "generated-file-id",
            "name": "Cloud title.zip",
            "mimeType": "application/zip",
            "webContentLink": "https://drive.google.com/original?resourcekey=opaque",
            "capabilities": { "canDownload": true }
        })))
        .mount(&server)
        .await;

    let file = GoogleDriveApi::get_file(&client(&server), ACCESS_TOKEN, "generated-file-id")
        .await
        .expect("final file");

    assert_eq!(file.id, "generated-file-id");
    assert_eq!(
        file.web_content_link.as_deref(),
        Some("https://drive.google.com/original?resourcekey=opaque")
    );
    assert!(file.can_download);
}

#[test]
fn resumable_retry_after_supports_seconds_and_http_date() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
    let later = now + Duration::from_secs(17);
    let http_date = httpdate::fmt_http_date(later);

    assert_eq!(
        parse_retry_after_at(" 12 ", now),
        Some(Duration::from_secs(12))
    );
    assert_eq!(
        parse_retry_after_at(&http_date, now),
        Some(Duration::from_secs(17))
    );
    assert_eq!(parse_retry_after_at("not-a-date", now), None);
}

#[tokio::test]
async fn resumable_classifies_rate_limits_separately_from_permanent_quota() {
    for (reason, expected) in [
        (
            "rateLimitExceeded",
            DriveApiError::RateLimited(Some(Duration::from_secs(3))),
        ),
        (
            "userRateLimitExceeded",
            DriveApiError::RateLimited(Some(Duration::from_secs(3))),
        ),
        ("storageQuotaExceeded", DriveApiError::QuotaExceeded),
    ] {
        let server = MockServer::start().await;
        let session = ResumableUploadSession::for_test(&format!("{}/session", server.uri()))
            .expect("session");
        Mock::given(method("PUT"))
            .and(path("/session"))
            .respond_with(
                ResponseTemplate::new(403)
                    .insert_header("retry-after", "3")
                    .set_body_json(json!({
                        "error": {
                            "errors": [{ "reason": reason }]
                        }
                    })),
            )
            .mount(&server)
            .await;

        assert_eq!(
            GoogleDriveApi::upload_chunk(&client(&server), ACCESS_TOKEN, &session, 0, b"zip", 3,)
                .await,
            Err(expected),
            "{reason}"
        );
    }
}

#[tokio::test]
async fn resumable_maps_access_token_expiry_for_the_task7_single_retry_lifecycle() {
    let server = MockServer::start().await;
    let session =
        ResumableUploadSession::for_test(&format!("{}/session", server.uri())).expect("session");
    Mock::given(method("PUT"))
        .and(path("/session"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::upload_chunk(&client(&server), ACCESS_TOKEN, &session, 0, b"zip", 3,).await,
        Err(DriveApiError::TokenExpired)
    );
}

#[tokio::test]
async fn resumable_initiation_and_generated_id_preserve_retryable_provider_classification() {
    let generate_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/generateIds"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "2")
                .set_body_json(json!({
                    "error": { "errors": [{ "reason": "userRateLimitExceeded" }] }
                })),
        )
        .mount(&generate_server)
        .await;

    assert_eq!(
        GoogleDriveApi::generate_id(&client(&generate_server), ACCESS_TOKEN).await,
        Err(DriveApiError::RateLimited(Some(Duration::from_secs(2))))
    );

    let create_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload/drive/v3/files"))
        .respond_with(ResponseTemplate::new(503).insert_header("retry-after", "4"))
        .mount(&create_server)
        .await;

    let create_client = client(&create_server);
    let create_metadata = DriveCreateMetadata {
        id: "generated-file-id".to_string(),
        parent_id: "folder-42".to_string(),
        name: "Song.zip".to_string(),
    };
    let error =
        GoogleDriveApi::start_resumable_create(&create_client, ACCESS_TOKEN, &create_metadata, 3);
    assert_eq!(
        error.await.expect_err("retryable initiation"),
        DriveApiError::Transient(Some(Duration::from_secs(4)))
    );
}

#[test]
fn resumable_session_debug_output_never_exposes_the_operation_local_uri() {
    let session = ResumableUploadSession::for_test(
        "https://upload.test/session?upload_id=provider-secret-session",
    )
    .expect("session");

    let debug = format!("{session:?}");
    assert!(!debug.contains("provider-secret-session"));
    assert!(!debug.contains("upload.test"));
    assert!(debug.contains("redacted"));
}

#[test]
fn resumable_session_rejects_insecure_provider_location_outside_local_test_endpoints() {
    assert_eq!(
        ResumableUploadSession::parse("http://provider.example/session", false)
            .expect_err("production session must be HTTPS"),
        DriveApiError::InvalidResponse
    );
    assert!(
        ResumableUploadSession::parse("https://provider.example/session", false).is_ok(),
        "production HTTPS session"
    );
    assert!(
        ResumableUploadSession::parse("http://127.0.0.1/session", true).is_ok(),
        "deterministic local test endpoint"
    );
}

// ---------------------------------------------------------------------------
// GoogleDriveValidationError::code() – every variant must produce a stable
// machine-readable string consumed by the frontend.
// ---------------------------------------------------------------------------

#[test]
fn validation_error_code_covers_every_variant() {
    assert_eq!(
        GoogleDriveValidationError::FolderUnavailable.code(),
        "FOLDER_UNAVAILABLE"
    );
    assert_eq!(
        GoogleDriveValidationError::DownloadNotPublic.code(),
        "DOWNLOAD_NOT_PUBLIC"
    );
    assert_eq!(
        GoogleDriveValidationError::SharingCheckUnavailable.code(),
        "SHARING_CHECK_UNAVAILABLE"
    );
    assert_eq!(
        GoogleDriveValidationError::FileNotFound.code(),
        "FILE_NOT_FOUND"
    );
    assert_eq!(
        GoogleDriveValidationError::FilePermissionDenied.code(),
        "FILE_PERMISSION_DENIED"
    );
    assert_eq!(
        GoogleDriveValidationError::TokenExpired.code(),
        "RECONNECT_REQUIRED"
    );
    assert_eq!(GoogleDriveValidationError::Network.code(), "NETWORK");
    assert_eq!(
        GoogleDriveValidationError::InvalidResponse.code(),
        "INVALID_RESPONSE"
    );
}

// ---------------------------------------------------------------------------
// From<GoogleDriveValidationError> conversions – both target enums must map
// every variant without loss.
// ---------------------------------------------------------------------------

#[test]
fn validation_error_converts_to_oauth_error_for_every_variant() {
    assert_eq!(
        GoogleDriveOAuthError::from(GoogleDriveValidationError::FolderUnavailable),
        GoogleDriveOAuthError::FolderUnavailable
    );
    assert_eq!(
        GoogleDriveOAuthError::from(GoogleDriveValidationError::DownloadNotPublic),
        GoogleDriveOAuthError::DownloadNotPublic
    );
    assert_eq!(
        GoogleDriveOAuthError::from(GoogleDriveValidationError::SharingCheckUnavailable),
        GoogleDriveOAuthError::SharingCheckUnavailable
    );
    assert_eq!(
        GoogleDriveOAuthError::from(GoogleDriveValidationError::FileNotFound),
        GoogleDriveOAuthError::FileNotFound
    );
    assert_eq!(
        GoogleDriveOAuthError::from(GoogleDriveValidationError::FilePermissionDenied),
        GoogleDriveOAuthError::FilePermissionDenied
    );
    assert_eq!(
        GoogleDriveOAuthError::from(GoogleDriveValidationError::TokenExpired),
        GoogleDriveOAuthError::ReconnectRequired
    );
    assert_eq!(
        GoogleDriveOAuthError::from(GoogleDriveValidationError::Network),
        GoogleDriveOAuthError::Network
    );
    assert_eq!(
        GoogleDriveOAuthError::from(GoogleDriveValidationError::InvalidResponse),
        GoogleDriveOAuthError::InvalidResponse
    );
}

#[test]
fn validation_error_converts_to_drive_api_error_for_every_variant() {
    assert_eq!(
        DriveApiError::from(GoogleDriveValidationError::TokenExpired),
        DriveApiError::TokenExpired
    );
    assert_eq!(
        DriveApiError::from(GoogleDriveValidationError::Network),
        DriveApiError::Network
    );
    assert_eq!(
        DriveApiError::from(GoogleDriveValidationError::FileNotFound),
        DriveApiError::NotFound
    );
    assert_eq!(
        DriveApiError::from(GoogleDriveValidationError::FolderUnavailable),
        DriveApiError::FolderUnavailable
    );
    assert_eq!(
        DriveApiError::from(GoogleDriveValidationError::DownloadNotPublic),
        DriveApiError::DownloadNotPublic
    );
    assert_eq!(
        DriveApiError::from(GoogleDriveValidationError::SharingCheckUnavailable),
        DriveApiError::SharingCheckUnavailable
    );
    assert_eq!(
        DriveApiError::from(GoogleDriveValidationError::FilePermissionDenied),
        DriveApiError::PermissionDenied
    );
    assert_eq!(
        DriveApiError::from(GoogleDriveValidationError::InvalidResponse),
        DriveApiError::InvalidResponse
    );
}

// ---------------------------------------------------------------------------
// parse_retry_after_at – seconds, http-date, invalid, past date, zero, empty.
// ---------------------------------------------------------------------------

#[test]
fn parse_retry_after_handles_seconds_zero_large_and_invalid_values() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);

    assert_eq!(parse_retry_after_at("0", now), Some(Duration::from_secs(0)));
    assert_eq!(
        parse_retry_after_at("999999999", now),
        Some(Duration::from_secs(999_999_999))
    );
    // Whitespace is trimmed before parsing.
    assert_eq!(
        parse_retry_after_at("  5  ", now),
        Some(Duration::from_secs(5))
    );
    // Empty / non-numeric / non-date strings yield None.
    assert_eq!(parse_retry_after_at("", now), None);
    assert_eq!(parse_retry_after_at("   ", now), None);
    assert_eq!(parse_retry_after_at("abc", now), None);
    assert_eq!(parse_retry_after_at("12.5", now), None);
}

#[test]
fn parse_retry_after_http_date_in_the_past_returns_none() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
    let past = now - Duration::from_secs(3600);
    let http_date = httpdate::fmt_http_date(past);

    // A date already in the past produces a negative duration → None.
    assert_eq!(parse_retry_after_at(&http_date, now), None);
}

// ---------------------------------------------------------------------------
// ResumableUploadSession::parse – malformed URLs, missing host, wrong scheme,
// loopback with allow_insecure=false, non-loopback with allow_insecure=true.
// ---------------------------------------------------------------------------

#[test]
fn resumable_session_parse_rejects_malformed_and_unsupported_schemes() {
    // Malformed URL.
    assert_eq!(
        ResumableUploadSession::parse("not a url", true).expect_err("malformed"),
        DriveApiError::InvalidResponse
    );
    // Non-http(s) scheme.
    assert_eq!(
        ResumableUploadSession::parse("ftp://example.com/session", true).expect_err("ftp scheme"),
        DriveApiError::InvalidResponse
    );
    // HTTPS with no host.
    assert_eq!(
        ResumableUploadSession::parse("https://", true).expect_err("no host"),
        DriveApiError::InvalidResponse
    );
    // HTTP loopback but allow_insecure=false.
    assert_eq!(
        ResumableUploadSession::parse("http://127.0.0.1/session", false).expect_err("insecure off"),
        DriveApiError::InvalidResponse
    );
    // HTTP non-loopback even when allow_insecure=true.
    assert_eq!(
        ResumableUploadSession::parse("http://example.com/session", true)
            .expect_err("non-loopback"),
        DriveApiError::InvalidResponse
    );
    // HTTP localhost variant is accepted when allow_insecure=true.
    assert!(ResumableUploadSession::parse("http://localhost/session", true).is_ok());
}

// ---------------------------------------------------------------------------
// GoogleDriveClient::with_base_url – invalid URL, bad scheme, missing
// /drive/v3 suffix, and trailing-slash normalisation.
// ---------------------------------------------------------------------------

#[test]
fn with_base_url_rejects_invalid_urls_and_non_http_schemes() {
    assert_eq!(
        GoogleDriveClient::with_base_url("not a url").expect_err("invalid url"),
        GoogleDriveValidationError::InvalidResponse
    );
    assert_eq!(
        GoogleDriveClient::with_base_url("ftp://example.com/drive/v3")
            .expect_err("non-http scheme"),
        GoogleDriveValidationError::InvalidResponse
    );
}

#[test]
fn with_base_url_rejects_paths_without_drive_v3_suffix() {
    assert_eq!(
        GoogleDriveClient::with_base_url("https://example.com/api/v1").expect_err("wrong api path"),
        GoogleDriveValidationError::InvalidResponse
    );
    assert_eq!(
        GoogleDriveClient::with_base_url("https://example.com/drive/v2")
            .expect_err("wrong drive version"),
        GoogleDriveValidationError::InvalidResponse
    );
}

#[tokio::test]
async fn with_base_url_normalises_missing_trailing_slash_and_derives_upload_path() {
    let server = MockServer::start().await;
    // Provide a URL without a trailing slash; the client should normalise it.
    let c = GoogleDriveClient::with_base_url(format!("{}/drive/v3", server.uri()))
        .expect("valid base url");

    // The upload base URL should replace /drive/v3 with /upload/drive/v3/.
    let session_url = format!("{}/upload-session/test", server.uri());
    Mock::given(method("POST"))
        .and(path("/upload/drive/v3/files"))
        .respond_with(ResponseTemplate::new(200).insert_header("location", session_url.as_str()))
        .mount(&server)
        .await;

    let session = c
        .start_resumable_create(
            ACCESS_TOKEN,
            &DriveCreateMetadata {
                id: "gen-id".to_string(),
                parent_id: "folder-1".to_string(),
                name: "song.zip".to_string(),
            },
            4,
        )
        .await
        .expect("create session");
    assert_eq!(session.as_str(), session_url);
}

// ---------------------------------------------------------------------------
// url_with_segments – empty or whitespace-only segments are rejected.
// ---------------------------------------------------------------------------

#[test]
fn url_with_segments_rejects_empty_or_whitespace_segments() {
    let base = Url::parse("https://example.com/drive/v3/").unwrap();
    assert_eq!(
        url_with_segments(&base, &["files", ""]),
        Err(GoogleDriveValidationError::InvalidResponse)
    );
    assert_eq!(
        url_with_segments(&base, &["files", "  "]),
        Err(GoogleDriveValidationError::InvalidResponse)
    );
    assert_eq!(
        url_with_segments(&base, &["", "files"]),
        Err(GoogleDriveValidationError::InvalidResponse)
    );
    // Valid segments produce a correct URL.
    let url = url_with_segments(&base, &["files", "abc"]).expect("valid url");
    assert_eq!(url.as_str(), "https://example.com/drive/v3/files/abc");
}

// ---------------------------------------------------------------------------
// usable_generated_id – empty, multiple, whitespace, oversized, valid.
// ---------------------------------------------------------------------------

#[test]
fn usable_generated_id_validates_count_and_content() {
    assert_eq!(
        usable_generated_id(vec![]),
        Err(GoogleDriveValidationError::InvalidResponse)
    );
    assert_eq!(
        usable_generated_id(vec!["a".to_string(), "b".to_string()]),
        Err(GoogleDriveValidationError::InvalidResponse)
    );
    assert_eq!(
        usable_generated_id(vec!["   ".to_string()]),
        Err(GoogleDriveValidationError::InvalidResponse)
    );
    let oversized = "x".repeat(MAX_PAGE_TOKEN_BYTES + 1);
    assert_eq!(
        usable_generated_id(vec![oversized]),
        Err(GoogleDriveValidationError::InvalidResponse)
    );
    // Valid id is trimmed and returned.
    assert_eq!(
        usable_generated_id(vec!["  gen-id  ".to_string()]),
        Ok("gen-id".to_string())
    );
}

// ---------------------------------------------------------------------------
// parse_confirmed_range – valid, missing prefix, non-numeric, overflow.
// ---------------------------------------------------------------------------

#[test]
fn parse_confirmed_range_parses_valid_byte_range() {
    let value = reqwest::header::HeaderValue::from_static("bytes=0-99");
    assert_eq!(parse_confirmed_range(&value), Ok(100));
}

#[test]
fn parse_confirmed_range_rejects_missing_prefix_and_non_numeric() {
    let missing_prefix = reqwest::header::HeaderValue::from_static("0-99");
    assert_eq!(
        parse_confirmed_range(&missing_prefix),
        Err(DriveApiError::InvalidResponse)
    );

    let non_numeric = reqwest::header::HeaderValue::from_static("bytes=0-abc");
    assert_eq!(
        parse_confirmed_range(&non_numeric),
        Err(DriveApiError::InvalidResponse)
    );
}

#[test]
fn parse_confirmed_range_rejects_u64_overflow_on_increment() {
    // u64::MAX + 1 overflows → Err.
    let value = reqwest::header::HeaderValue::from_static("bytes=0-18446744073709551615");
    assert_eq!(
        parse_confirmed_range(&value),
        Err(DriveApiError::InvalidResponse)
    );
}

// ---------------------------------------------------------------------------
// HTTP-mocked: decode_chunk_response – 200/201 Complete, 404 status probe,
// 308 with confirmed range exceeding total.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn chunk_response_200_and_201_signal_completion() {
    for status in [200u16, 201] {
        let server = MockServer::start().await;
        let session = ResumableUploadSession::for_test(&format!("{}/session", server.uri()))
            .expect("session");
        Mock::given(method("PUT"))
            .and(path("/session"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;

        assert_eq!(
            GoogleDriveApi::upload_chunk(&client(&server), ACCESS_TOKEN, &session, 0, b"zip", 3,)
                .await,
            Ok(DriveChunkResult::Complete),
            "status {status}"
        );
    }
}

#[tokio::test]
async fn chunk_status_probe_404_maps_to_session_expired() {
    let server = MockServer::start().await;
    let session =
        ResumableUploadSession::for_test(&format!("{}/session", server.uri())).expect("session");
    Mock::given(method("PUT"))
        .and(path("/session"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::query_session_status(&client(&server), ACCESS_TOKEN, &session, 10).await,
        Err(DriveApiError::SessionExpired)
    );
}

#[tokio::test]
async fn chunk_308_with_confirmed_range_exceeding_total_is_invalid() {
    let server = MockServer::start().await;
    let session =
        ResumableUploadSession::for_test(&format!("{}/session", server.uri())).expect("session");
    Mock::given(method("PUT"))
        .and(path("/session"))
        .respond_with(
            ResponseTemplate::new(308)
                // confirmed = 101 (bytes 0-100), but total is only 10
                .insert_header("range", "bytes=0-100"),
        )
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::upload_chunk(&client(&server), ACCESS_TOKEN, &session, 0, b"zip", 10).await,
        Err(DriveApiError::InvalidResponse)
    );
}

// ---------------------------------------------------------------------------
// HTTP-mocked: decode_resumable_session (validation-error variant used by the
// inherent impl) – 401, 403, 404, missing/empty/oversized location.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn resumable_create_inherent_maps_http_errors_to_validation_errors() {
    for (status, expected) in [
        (401u16, GoogleDriveValidationError::TokenExpired),
        (403, GoogleDriveValidationError::FilePermissionDenied),
        (404, GoogleDriveValidationError::FileNotFound),
        (500, GoogleDriveValidationError::InvalidResponse),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/upload/drive/v3/files"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;

        let error = client(&server)
            .start_resumable_create(
                ACCESS_TOKEN,
                &DriveCreateMetadata {
                    id: "gen-id".to_string(),
                    parent_id: "folder-1".to_string(),
                    name: "song.zip".to_string(),
                },
                4,
            )
            .await
            .expect_err("should error");
        assert_eq!(error, expected, "status {status}");
    }
}

#[tokio::test]
async fn resumable_create_inherent_rejects_missing_empty_or_oversized_location() {
    let metadata = DriveCreateMetadata {
        id: "gen-id".to_string(),
        parent_id: "folder-1".to_string(),
        name: "song.zip".to_string(),
    };

    // Missing Location header on a 200.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload/drive/v3/files"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    assert_eq!(
        client(&server)
            .start_resumable_create(ACCESS_TOKEN, &metadata, 4)
            .await
            .expect_err("missing location"),
        GoogleDriveValidationError::InvalidResponse
    );

    // Empty / whitespace-only Location header.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload/drive/v3/files"))
        .respond_with(ResponseTemplate::new(200).insert_header("location", "   "))
        .mount(&server)
        .await;
    assert_eq!(
        client(&server)
            .start_resumable_create(ACCESS_TOKEN, &metadata, 4)
            .await
            .expect_err("empty location"),
        GoogleDriveValidationError::InvalidResponse
    );

    // Oversized Location header (> 16 KiB).
    let server = MockServer::start().await;
    let oversized = format!(
        "https://upload.example/s/{}",
        "x".repeat(MAX_SESSION_URI_BYTES)
    );
    Mock::given(method("POST"))
        .and(path("/upload/drive/v3/files"))
        .respond_with(ResponseTemplate::new(200).insert_header("location", oversized.as_str()))
        .mount(&server)
        .await;
    assert_eq!(
        client(&server)
            .start_resumable_create(ACCESS_TOKEN, &metadata, 4)
            .await
            .expect_err("oversized location"),
        GoogleDriveValidationError::InvalidResponse
    );
}

// ---------------------------------------------------------------------------
// HTTP-mocked: resumable_create / resumable_update inherent impl rejects
// empty metadata fields before making any network request.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn resumable_create_inherent_rejects_empty_metadata_without_network() {
    let server = MockServer::start().await;
    // No mocks mounted – any request would fail.  The client must short-circuit.
    for (id, parent_id, name) in [
        ("", "folder-1", "song.zip"),
        ("gen-id", "", "song.zip"),
        ("gen-id", "folder-1", ""),
        ("  ", "folder-1", "song.zip"),
        ("gen-id", "  ", "song.zip"),
        ("gen-id", "folder-1", "  "),
    ] {
        let error = client(&server)
            .start_resumable_create(
                ACCESS_TOKEN,
                &DriveCreateMetadata {
                    id: id.to_string(),
                    parent_id: parent_id.to_string(),
                    name: name.to_string(),
                },
                4,
            )
            .await
            .expect_err("should error");
        assert_eq!(
            error,
            GoogleDriveValidationError::InvalidResponse,
            "id={id:?} parent={parent_id:?} name={name:?}"
        );
    }
}

#[tokio::test]
async fn resumable_update_inherent_rejects_empty_fields_without_network() {
    let server = MockServer::start().await;
    for (file_id, name) in [
        ("", "song.zip"),
        ("file-1", ""),
        ("  ", "song.zip"),
        ("file-1", "  "),
    ] {
        let error = client(&server)
            .start_resumable_update(
                ACCESS_TOKEN,
                file_id,
                &DriveUpdateMetadata {
                    name: name.to_string(),
                },
                4,
            )
            .await
            .expect_err("should error");
        assert_eq!(
            error,
            GoogleDriveValidationError::InvalidResponse,
            "file_id={file_id:?} name={name:?}"
        );
    }
}

// ---------------------------------------------------------------------------
// HTTP-mocked: classify_drive_response via trait get_file / delete_file –
// 404 NotFound, 500 Transient, 403 PermissionDenied, quota reasons.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_file_maps_404_to_not_found_and_500_to_transient() {
    for (status, expected) in [
        (404u16, DriveApiError::NotFound),
        (500, DriveApiError::Transient(None)),
        (502, DriveApiError::Transient(None)),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/file-1"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;

        assert_eq!(
            GoogleDriveApi::get_file(&client(&server), ACCESS_TOKEN, "file-1").await,
            Err(expected),
            "status {status}"
        );
    }
}

#[tokio::test]
async fn get_file_maps_403_without_special_reason_to_permission_denied() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({
            "error": { "errors": [{ "reason": "insufficientFilePermissions" }] }
        })))
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::get_file(&client(&server), ACCESS_TOKEN, "file-1").await,
        Err(DriveApiError::PermissionDenied)
    );
}

#[tokio::test]
async fn classify_drive_response_maps_quota_reasons_to_quota_exceeded() {
    for reason in [
        "dailyLimitExceeded",
        "activeItemCreationLimitExceeded",
        "teamDriveFileLimitExceeded",
        "teamDriveHierarchyTooDeep",
        "quotaExceeded",
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/file-1"))
            .respond_with(ResponseTemplate::new(403).set_body_json(json!({
                "error": { "errors": [{ "reason": reason }] }
            })))
            .mount(&server)
            .await;

        assert_eq!(
            GoogleDriveApi::get_file(&client(&server), ACCESS_TOKEN, "file-1").await,
            Err(DriveApiError::QuotaExceeded),
            "reason {reason}"
        );
    }
}

#[tokio::test]
async fn delete_file_maps_404_to_not_found_and_500_to_transient() {
    for (status, expected) in [
        (404u16, DriveApiError::NotFound),
        (503, DriveApiError::Transient(None)),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("DELETE"))
            .and(path("/drive/v3/files/file-1"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;

        assert_eq!(
            GoogleDriveApi::delete_file(&client(&server), ACCESS_TOKEN, "file-1").await,
            Err(expected),
            "status {status}"
        );
    }
}

#[tokio::test]
async fn delete_file_succeeds_on_204_no_content() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/drive/v3/files/file-1"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::delete_file(&client(&server), ACCESS_TOKEN, "file-1").await,
        Ok(())
    );
}

// ---------------------------------------------------------------------------
// HTTP-mocked: classify_drive_response 429 with retry-after header.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_file_429_maps_to_rate_limited_with_retry_after() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "7")
                .set_body_json(json!({ "error": { "errors": [{ "reason": "quotaExceeded" }] } })),
        )
        .mount(&server)
        .await;

    // 429 short-circuits before inspecting the error body.
    assert_eq!(
        GoogleDriveApi::get_file(&client(&server), ACCESS_TOKEN, "file-1").await,
        Err(DriveApiError::RateLimited(Some(Duration::from_secs(7))))
    );
}

// ---------------------------------------------------------------------------
// HTTP-mocked: validate_file_before_update – trashed file → FileNotFound.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn validate_file_before_update_treats_trashed_file_as_not_found() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/trashed-file"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "trashed-file",
            "trashed": true
        })))
        .mount(&server)
        .await;

    assert_eq!(
        client(&server)
            .validate_file_before_update(ACCESS_TOKEN, "trashed-file")
            .await,
        Err(GoogleDriveValidationError::FileNotFound)
    );
}

// ---------------------------------------------------------------------------
// HTTP-mocked: permission pagination – repeated page token → InvalidResponse.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn permission_pagination_repeated_page_token_is_invalid_response() {
    let server = MockServer::start().await;
    mount_valid_folder(&server, "folder-42").await;
    // Both pages return the same nextPageToken, which the dedup guard must catch.
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/folder-42/permissions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "permissions": [],
            "nextPageToken": "repeated-token"
        })))
        .mount(&server)
        .await;

    assert_eq!(
        client(&server)
            .validate_folder(ACCESS_TOKEN, "folder-42")
            .await,
        Err(GoogleDriveValidationError::InvalidResponse)
    );
}

// ---------------------------------------------------------------------------
// HTTP-mocked: upload_chunk / query_session_status reject invalid byte ranges
// (empty bytes, start >= total, start + len > total).
// ---------------------------------------------------------------------------

#[tokio::test]
async fn upload_chunk_rejects_invalid_byte_ranges_without_network() {
    let server = MockServer::start().await;
    let session =
        ResumableUploadSession::for_test(&format!("{}/session", server.uri())).expect("session");

    // Empty bytes.
    assert_eq!(
        GoogleDriveApi::upload_chunk(&client(&server), ACCESS_TOKEN, &session, 0, b"", 10).await,
        Err(DriveApiError::InvalidResponse)
    );
    // start >= total.
    assert_eq!(
        GoogleDriveApi::upload_chunk(&client(&server), ACCESS_TOKEN, &session, 10, b"zip", 10)
            .await,
        Err(DriveApiError::InvalidResponse)
    );
    // start + len > total.
    assert_eq!(
        GoogleDriveApi::upload_chunk(&client(&server), ACCESS_TOKEN, &session, 8, b"zip", 10).await,
        Err(DriveApiError::InvalidResponse)
    );
}

// ---------------------------------------------------------------------------
// HTTP-mocked: get_file_for_update requests the update-specific field set.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_file_for_update_requests_can_edit_capability_fields() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1"))
        .and(query_param(
            "fields",
            "id,name,mimeType,trashed,capabilities(canEdit)",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "file-1",
            "name": "song.zip",
            "mimeType": "application/zip",
            "trashed": false,
            "capabilities": { "canEdit": true }
        })))
        .mount(&server)
        .await;

    let file = GoogleDriveApi::get_file_for_update(&client(&server), ACCESS_TOKEN, "file-1")
        .await
        .expect("update file");
    assert_eq!(file.id, "file-1");
    assert!(file.can_edit);
}

// ---------------------------------------------------------------------------
// HTTP-mocked: validate_public_permission (trait method) returns the raw
// PublicPermissionStatus for an existing file.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn validate_public_permission_trait_returns_status_for_existing_file() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1/permissions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "permissions": [{
                "id": "perm-1",
                "type": "anyone",
                "role": "reader",
                "view": null,
                "allowFileDiscovery": false
            }]
        })))
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::validate_public_permission(&client(&server), ACCESS_TOKEN, "file-1").await,
        Ok(PublicPermissionStatus::Public)
    );
}

#[tokio::test]
async fn validate_public_permission_trait_403_is_check_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1/permissions"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::validate_public_permission(&client(&server), ACCESS_TOKEN, "file-1").await,
        Ok(PublicPermissionStatus::CheckUnavailable)
    );
}

// ---------------------------------------------------------------------------
// Additional coverage tests for previously uncovered lines.
// ---------------------------------------------------------------------------

#[cfg(feature = "google-drive")]
#[test]
fn production_client_builds_successfully() {
    assert!(GoogleDriveClient::production().is_ok());
}

#[tokio::test]
async fn validate_file_before_update_rejects_id_mismatch() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "different-id",
            "trashed": false
        })))
        .mount(&server)
        .await;

    assert_eq!(
        client(&server)
            .validate_file_before_update(ACCESS_TOKEN, "file-1")
            .await,
        Err(GoogleDriveValidationError::InvalidResponse)
    );
}

#[tokio::test]
async fn validate_file_before_update_returns_download_not_public() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "file-1",
            "trashed": false
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1/permissions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "permissions": []
        })))
        .mount(&server)
        .await;

    assert_eq!(
        client(&server)
            .validate_file_before_update(ACCESS_TOKEN, "file-1")
            .await,
        Err(GoogleDriveValidationError::DownloadNotPublic)
    );
}

#[tokio::test]
async fn validate_file_before_update_returns_sharing_check_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "file-1",
            "trashed": false
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1/permissions"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;

    assert_eq!(
        client(&server)
            .validate_file_before_update(ACCESS_TOKEN, "file-1")
            .await,
        Err(GoogleDriveValidationError::SharingCheckUnavailable)
    );
}

#[tokio::test]
async fn folder_validation_maps_500_to_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/folder-42"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;

    assert_eq!(
        client(&server)
            .validate_folder(ACCESS_TOKEN, "folder-42")
            .await,
        Err(GoogleDriveValidationError::InvalidResponse)
    );
}

#[tokio::test]
async fn trait_validate_folder_maps_404_to_drive_api_folder_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/missing-folder"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::validate_folder(&client(&server), ACCESS_TOKEN, "missing-folder").await,
        Err(DriveApiError::FolderUnavailable)
    );
}

#[tokio::test]
async fn trait_validate_public_permission_maps_401_to_token_expired() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/file-1/permissions"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;

    assert_eq!(
        GoogleDriveApi::validate_public_permission(&client(&server), ACCESS_TOKEN, "file-1").await,
        Err(DriveApiError::TokenExpired)
    );
}

#[tokio::test]
async fn picker_folder_validator_returns_folder_setting_on_success() {
    let server = MockServer::start().await;
    mount_valid_folder(&server, "folder-42").await;
    mount_public_permissions(&server, "folder-42").await;

    let c = client(&server);
    let result = PickerFolderValidator::validate_folder(&c, ACCESS_TOKEN, "folder-42").await;
    assert_eq!(
        result,
        Ok(GoogleDriveFolderSetting {
            id: "folder-42".to_string(),
            name: "Public uploads".to_string(),
        })
    );
}

#[tokio::test]
async fn picker_folder_validator_execute_validation_maps_token_expired() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/folder-42"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;

    let c = client(&server);
    let result = PickerFolderValidator::execute_validation(&c, ACCESS_TOKEN, "folder-42").await;
    assert_eq!(result, Err(AuthorizedDriveRequestError::TokenExpired));
}

#[tokio::test]
async fn picker_folder_validator_execute_validation_maps_other_errors_to_request() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/drive/v3/files/folder-42"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let c = client(&server);
    let result = PickerFolderValidator::execute_validation(&c, ACCESS_TOKEN, "folder-42").await;
    assert_eq!(
        result,
        Err(AuthorizedDriveRequestError::Request(
            GoogleDriveOAuthError::FolderUnavailable
        ))
    );
}

#[tokio::test]
async fn trait_start_resumable_create_success_parses_session_location() {
    let server = MockServer::start().await;
    let session_url = format!("{}/upload-session/trait-create", server.uri());
    Mock::given(method("POST"))
        .and(path("/upload/drive/v3/files"))
        .and(query_param("uploadType", "resumable"))
        .and(query_param("supportsAllDrives", "true"))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(header("x-upload-content-type", "application/zip"))
        .and(header("x-upload-content-length", "7"))
        .and(body_json(json!({
            "id": "generated-file-id",
            "name": "AC-DC.zip",
            "mimeType": "application/zip",
            "parents": ["folder-42"]
        })))
        .respond_with(ResponseTemplate::new(200).insert_header("location", session_url.as_str()))
        .mount(&server)
        .await;

    let session = GoogleDriveApi::start_resumable_create(
        &client(&server),
        ACCESS_TOKEN,
        &DriveCreateMetadata {
            id: "generated-file-id".to_string(),
            parent_id: "folder-42".to_string(),
            name: "AC-DC.zip".to_string(),
        },
        7,
    )
    .await
    .expect("create session via trait");

    assert_eq!(session.as_str(), session_url);
}

#[tokio::test]
async fn trait_start_resumable_update_success_parses_session_location() {
    let server = MockServer::start().await;
    let session_url = format!("{}/upload-session/trait-update", server.uri());
    Mock::given(method("PATCH"))
        .and(path("/upload/drive/v3/files/existing-file"))
        .and(query_param("uploadType", "resumable"))
        .and(query_param("supportsAllDrives", "true"))
        .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
        .and(header("x-upload-content-type", "application/zip"))
        .and(header("x-upload-content-length", "11"))
        .and(body_json(json!({
            "name": "Song: Reprise.zip",
            "mimeType": "application/zip"
        })))
        .respond_with(ResponseTemplate::new(200).insert_header("location", session_url.as_str()))
        .mount(&server)
        .await;

    let session = GoogleDriveApi::start_resumable_update(
        &client(&server),
        ACCESS_TOKEN,
        "existing-file",
        &DriveUpdateMetadata {
            name: "Song: Reprise.zip".to_string(),
        },
        11,
    )
    .await
    .expect("update session via trait");

    assert_eq!(session.as_str(), session_url);
}

#[tokio::test]
async fn trait_start_resumable_create_rejects_missing_location() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload/drive/v3/files"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let result = GoogleDriveApi::start_resumable_create(
        &client(&server),
        ACCESS_TOKEN,
        &DriveCreateMetadata {
            id: "gen-id".to_string(),
            parent_id: "folder-1".to_string(),
            name: "song.zip".to_string(),
        },
        4,
    )
    .await;

    assert!(matches!(result, Err(DriveApiError::InvalidResponse)));
}
