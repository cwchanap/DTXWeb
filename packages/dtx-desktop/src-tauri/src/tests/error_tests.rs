use super::*;

#[test]
fn message_variant_serializes_to_its_message_string() {
    // The Tauri command layer serializes DesktopError into the IPC
    // response via the manual Serialize impl — it must collapse to a
    // plain JSON string (not an object) so the renderer can read it as
    // `error instanceof string`.
    let error = DesktopError::Message("something failed".to_string());
    let json = serde_json::to_value(error).unwrap();
    assert_eq!(json, serde_json::json!("something failed"));
}

#[test]
fn io_variant_converts_from_std_io_error_and_serializes_with_prefix() {
    // The `?` operator relies on the `From<std::io::Error>` impl to lift
    // I/O errors out of fs calls. The serialized form keeps the
    // "I/O error: " prefix so logs and the renderer can distinguish
    // error classes.
    let io_error = std::io::Error::from(std::io::ErrorKind::NotFound);
    let error: DesktopError = io_error.into();

    let json = serde_json::to_value(error).unwrap();
    let serialized = json.as_str().unwrap();
    assert!(
        serialized.starts_with("I/O error:"),
        "expected I/O prefix, got: {serialized}"
    );
}

#[test]
fn url_variant_converts_from_parse_error() {
    // Auth/URL parsing failures bubble up through `url::ParseError`. The
    // `From` impl lets `?` lift them into DesktopError without manual
    // mapping at each call site.
    let parse_error = "not a url".parse::<url::Url>().unwrap_err();
    let error: DesktopError = parse_error.into();

    let serialized = serde_json::to_value(error)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        serialized.starts_with("URL error:"),
        "expected URL prefix, got: {serialized}"
    );
}

#[test]
fn json_variant_converts_from_serde_json_error() {
    let json_error = serde_json::from_str::<serde_json::Value>("{bad}").unwrap_err();
    let error: DesktopError = json_error.into();

    let serialized = serde_json::to_value(error)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        serialized.starts_with("JSON error:"),
        "expected JSON prefix, got: {serialized}"
    );
}

#[test]
fn zip_variant_converts_from_zip_error() {
    // The export-to-zip path uses `?` over `zip::result::ZipError`. This
    // conversion must work for both archive-write and archive-read paths.
    let zip_error = zip::result::ZipError::FileNotFound;
    let error: DesktopError = zip_error.into();

    let serialized = serde_json::to_value(error)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        serialized.starts_with("Zip error:"),
        "expected Zip prefix, got: {serialized}"
    );
}

#[test]
fn dialog_plugin_variant_serializes_to_a_distinct_message() {
    // A dropped oneshot sender (dialog plugin panic) must surface as a
    // typed error, not a generic Message, so the renderer can distinguish
    // a plugin failure from a user cancel.
    let error = DesktopError::DialogPlugin;
    let json = serde_json::to_value(error).unwrap();
    assert_eq!(json, serde_json::json!("Dialog plugin closed unexpectedly"));
}

#[test]
fn desktop_error_implements_send_and_sync() {
    // Tauri commands are async, so the error type must be Send + Sync to
    // cross the async boundary. This is a compile-time assertion; if it
    // compiles, the trait bounds hold.
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<DesktopError>();
}
