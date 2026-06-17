    use super::*;
    use std::fs;
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
            "isPublished": true,
            "downloadUrl": "https://files/song.zip",
            "previewUrl": "https://files/preview.jpg",
            "videoPreviewUrl": null,
            "publishDate": "2024-01-01",
            "createdAt": "2024-01-02",
            "updatedAt": "2024-01-03",
            "dtxFiles": [{ "level": 9.2, "label": "EXT" }]
        })
    }

    fn gql_simfile_with_id(id: i64) -> Value {
        let mut simfile = gql_simfile();
        simfile["id"] = json!(id.to_string());
        simfile
    }

    #[test]
    fn api_base_url_trims_whitespace_and_trailing_slash() {
        let base =
            api_base_url_from_values(Some(" https://api.example.com/ ")).expect("base url");

        assert_eq!(base, "https://api.example.com");
    }

    #[test]
    fn api_base_url_rejects_empty_value() {
        let result = api_base_url_from_values(Some(""));

        assert!(result.is_err());
    }

    #[test]
    fn renderer_simfile_maps_graphql_camel_case_to_snake_case() {
        let mapped = renderer_simfile_from_graphql(&gql_simfile()).expect("mapped");

        assert_eq!(mapped["id"], 42);
        assert_eq!(mapped["display_id"], 7);
        assert_eq!(mapped["user_id"], "user-1");
        assert_eq!(mapped["is_published"], true);
        assert_eq!(mapped["download_url"], "https://files/song.zip");
        assert_eq!(mapped["preview_url"], "https://files/preview.jpg");
        assert_eq!(mapped["video_preview_url"], Value::Null);
        assert_eq!(mapped["publish_date"], "2024-01-01");
        assert_eq!(mapped["created_at"], "2024-01-02");
        assert_eq!(mapped["updated_at"], "2024-01-03");
        assert_eq!(mapped["dtx_files"][0]["id"], 1);
        assert_eq!(mapped["dtx_files"][0]["label"], "EXT");
    }

    #[test]
    fn list_simfiles_query_requests_persisted_catalog_urls() {
        // The list feeds auto-linking, which caches linked simfiles via
        // `renderer_simfile_from_graphql`. Those cached records later populate
        // the metadata editor, so the persisted URL fields must be present in
        // the list response — otherwise opening and saving an auto-linked song
        // overwrites the real URLs with empty strings.
        assert!(LIST_SIMFILES_QUERY.contains("downloadUrl"));
        assert!(LIST_SIMFILES_QUERY.contains("previewUrl"));
        assert!(LIST_SIMFILES_QUERY.contains("videoPreviewUrl"));
        assert!(LIST_SIMFILES_QUERY.contains("dtxFiles"));
        // Still a curated field set (not the full fragment) to keep the
        // payload lean.
        assert!(!LIST_SIMFILES_QUERY.contains("...SimfileFull"));
    }

    #[test]
    fn update_input_maps_renderer_snake_case_to_graphql_camel_case() {
        let mapped = update_input_from_renderer(json!({
            "display_id": 3,
            "publish_date": "2024-01-01",
            "is_published": true,
            "download_url": "https://files/song.zip",
            "video_preview_url": "https://video",
            "preview_url": "https://files/preview.jpg",
            "title": "Song"
        }));

        assert_eq!(
            mapped,
            json!({
                "displayId": 3,
                "publishDate": "2024-01-01",
                "isPublished": true,
                "downloadUrl": "https://files/song.zip",
                "videoPreviewUrl": "https://video",
                "previewUrl": "https://files/preview.jpg",
                "title": "Song"
            })
        );
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

        let result =
            run_graphql_value(&server.uri(), "token-1", "query Test { ok }", json!({})).await;

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

        let result =
            run_graphql_value(&server.uri(), "token-1", "query Test { ok }", json!({})).await;

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

        let result = upload_file_to_api(
            &server.uri(),
            "token-1",
            "dir/kick.wav",
            song_folder.to_str().expect("utf8 path"),
            "42",
        )
        .await;

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

        let result =
            read_preview_within_workspace(outside.path().to_str().unwrap(), workspace.path().to_str().unwrap(), "preview.jpg")
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

        let result =
            read_preview_within_workspace(song.to_str().unwrap(), workspace.path().to_str().unwrap(), "preview.jpg")
                .await;

        assert!(matches!(result, Ok(None)));
    }

    #[tokio::test]
    async fn read_preview_reads_file_inside_workspace() {
        let workspace = tempfile::tempdir().expect("workspace");
        let song = workspace.path().join("song");
        fs::create_dir(&song).expect("song dir");
        fs::write(song.join("preview.jpg"), b"img").expect("preview");

        let result =
            read_preview_within_workspace(song.to_str().unwrap(), workspace.path().to_str().unwrap(), "preview.jpg")
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

    #[test]
    fn create_input_from_renderer_maps_renderer_fields_to_graphql_input() {
        let renderer = json!({
            "title": "Song",
            "artist": "Artist",
            "bpm": 180,
            "displayId": 7,
            "isPublished": true,
            "publishDate": "2024-01-01",
            "downloadUrl": "https://files/song.zip",
            "videoPreviewUrl": "https://video",
            "levels": [{ "label": "EXT", "level": 9.2 }]
        });

        let input = create_input_from_renderer(&renderer);

        assert_eq!(input["title"], "Song");
        assert_eq!(input["artist"], "Artist");
        assert_eq!(input["bpm"], 180);
        assert_eq!(input["displayId"], 7);
        assert_eq!(input["isPublished"], true);
        assert_eq!(input["publishDate"], "2024-01-01");
        assert_eq!(input["downloadUrl"], "https://files/song.zip");
        assert_eq!(input["videoPreviewUrl"], "https://video");
        assert_eq!(input["dtxFiles"][0]["label"], "EXT");
        assert_eq!(input["dtxFiles"][0]["level"], 9.2);
    }

    #[test]
    fn create_input_from_renderer_defaults_missing_fields_and_nulls_levels() {
        let input = create_input_from_renderer(&json!({ "title": "Song" }));

        assert_eq!(input["title"], "Song");
        assert_eq!(input["artist"], "");
        assert_eq!(input["bpm"], 0);
        assert_eq!(input["displayId"], Value::Null);
        assert_eq!(input["dtxFiles"], Value::Null);
    }

    #[test]
    fn update_input_from_renderer_returns_non_object_input_unchanged() {
        assert_eq!(update_input_from_renderer(json!([1, 2, 3])), json!([1, 2, 3]));
        assert_eq!(update_input_from_renderer(json!("plain")), json!("plain"));
        assert_eq!(update_input_from_renderer(json!(42)), json!(42));
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

        assert!(matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("boom")));
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

        assert!(matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("failed")));
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

        assert!(matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("502")));
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

        assert!(matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("Server")));
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

        assert!(matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("Something went wrong")));
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

        assert!(matches!(result, ApiResultValue::Failure { ref error, code: None } if error.contains("GraphQL")));
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
        let result = upload_file_to_api(
            "https://api.example.com",
            "token-1",
            "kick.wav",
            "/this/path/does/not/exist",
            "42",
        )
        .await;

        assert_eq!(result["success"], false);
        assert!(result["error"].as_str().unwrap().contains("File not found"));
    }

    #[tokio::test]
    async fn upload_file_to_api_fails_when_file_missing_within_folder() {
        let temp = tempfile::tempdir().expect("tempdir");

        let result = upload_file_to_api(
            "https://api.example.com",
            "token-1",
            "missing.wav",
            temp.path().to_str().expect("utf8 path"),
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
    async fn get_preview_urls_build_paths_from_bucket_env() {
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

        assert!(access_token_from_auth_state(&state).await.is_err());
    }

    #[tokio::test]
    async fn access_token_from_auth_state_returns_token_from_session() {
        let state = AuthState::default();
        state
            .set_current_session(Some(json!({ "access_token": "tok-1" })))
            .await;

        let token = access_token_from_auth_state(&state).await.expect("token");

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
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "data": { "nextDisplayId": 42 } })),
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

        let result = search_cloud_songs_impl(
            &server.uri(),
            "token-1",
            "Song".to_string(),
            None,
            None,
        )
        .await
        .expect("result");

        assert_eq!(result["success"], true);
        assert_eq!(result["data"].as_array().unwrap().len(), 1);
        assert_eq!(result["data"][0]["id"], 1);
        assert_eq!(result["data"][0]["title"], "Song");
        assert_eq!(result["data"][0]["is_published"], true);
    }

    #[tokio::test]
    async fn search_cloud_songs_impl_returns_empty_array_for_no_results() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "data": { "simfileSearch": [] } })),
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

        let result =
            search_cloud_songs_impl(&server.uri(), "token-1", "Song".to_string(), None, None)
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

        let result = fetch_cloud_song_impl(&server.uri(), "token-1", json!(42))
            .await
            .expect("result");

        assert_eq!(result["success"], true);
        assert_eq!(result["cloudSongData"]["id"], 42);
        assert_eq!(result["cloudSongData"]["title"], "Song");
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

        let result = fetch_cloud_song_impl(&server.uri(), "token-1", json!(42))
            .await
            .expect("result");

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
            json!(42),
            json!({ "title": "Updated" }),
        )
        .await
        .expect("result");

        assert_eq!(result["success"], true);
        assert_eq!(result["data"]["id"], 42);
        assert_eq!(result["data"]["title"], "Song");
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

        let result =
            update_simfile_record_impl(&server.uri(), "token-1", json!(42), json!({}))
                .await
                .expect("result");

        assert_eq!(result["success"], false);
    }

    #[tokio::test]
    async fn load_asset_files_impl_short_circuits_for_zero_or_empty_id() {
        let server = MockServer::start().await;

        for id in ["0", ""] {
            let result =
                load_asset_files_impl(&server.uri(), "token-1", id.to_string())
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
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": { "createSimfile": gql_simfile() }
            })))
            .mount(&server)
            .await;

        let result = create_simfile_record_impl(
            &server.uri(),
            "token-1",
            json!({ "title": "Song", "artist": "Artist" }),
        )
        .await
        .expect("result");

        assert_eq!(result["success"], true);
        assert_eq!(result["simfileId"], "42");
        assert_eq!(result["data"]["id"], 42);
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

        let result = create_simfile_record_impl(
            &server.uri(),
            "token-1",
            json!({
                "title": "Song",
                "songPath": song.to_str().unwrap(),
                "workspaceRoot": workspace.path().to_str().unwrap()
            }),
        )
        .await
        .expect("result");

        assert_eq!(result["success"], true);
        assert!(result.get("warnings").is_none());
    }
