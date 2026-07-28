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
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Dialog plugin closed unexpectedly")]
    DialogPlugin,
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
#[path = "tests/error_tests.rs"]
mod tests;
