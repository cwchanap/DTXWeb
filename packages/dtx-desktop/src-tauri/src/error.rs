use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DesktopError {
    #[error("{0}")]
    Message(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("URL error: {0}")]
    Url(#[from] url::ParseError),
    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("Zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
}

impl Serialize for DesktopError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, DesktopError>;

#[cfg(test)]
mod tests {
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
    fn desktop_error_implements_send_and_sync() {
        // Tauri commands are async, so the error type must be Send + Sync to
        // cross the async boundary. This is a compile-time assertion; if it
        // compiles, the trait bounds hold.
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<DesktopError>();
    }
}
