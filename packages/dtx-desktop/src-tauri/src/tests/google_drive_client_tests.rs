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
