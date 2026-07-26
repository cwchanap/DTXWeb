use super::*;
use serde_json::json;
use wiremock::matchers::{header, method, path, query_param};
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
