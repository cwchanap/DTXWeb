use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogResult {
    pub canceled: bool,
    #[serde(rename = "filePaths")]
    pub file_paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PathExistsResult {
    pub exists: bool,
    pub error: Option<String>,
}

/// Result of reading a file for the renderer. Each variant carries only the
/// fields that are meaningful for its kind: `Error` never has content, and
/// `Text`/`Binary` never have an error. The custom `Serialize` impl below still
/// emits the full `{ kind, error, content }` shape the renderer expects, so the
/// wire contract is unchanged — only the illegal Rust states (e.g. an `Error`
/// with stray content) are now unrepresentable.
#[derive(Debug, Clone)]
pub enum ReadFileResult {
    Error { error: String },
    Text { content: String },
    Binary { content: Vec<u8> },
}

impl Serialize for ReadFileResult {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Error { error } => {
                #[derive(Serialize)]
                struct ErrorResult<'a> {
                    kind: &'static str,
                    error: &'a str,
                    content: &'a str,
                }

                ErrorResult {
                    kind: "error",
                    error,
                    content: "",
                }
                .serialize(serializer)
            }
            Self::Text { content } => {
                #[derive(Serialize)]
                struct TextResult<'a> {
                    kind: &'static str,
                    error: Option<&'a str>,
                    content: &'a str,
                }

                TextResult {
                    kind: "text",
                    error: None,
                    content,
                }
                .serialize(serializer)
            }
            Self::Binary { content } => {
                #[derive(Serialize)]
                struct BinaryResult<'a> {
                    kind: &'static str,
                    error: Option<&'a str>,
                    content: &'a [u8],
                }

                BinaryResult {
                    kind: "binary",
                    error: None,
                    content,
                }
                .serialize(serializer)
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isExpanded")]
    pub is_expanded: bool,
    #[serde(rename = "isLoading")]
    pub is_loading: bool,
    pub children: Vec<TreeNode>,
    #[serde(rename = "hasChildren")]
    pub has_children: bool,
    #[serde(rename = "containsDtxFiles")]
    pub contains_dtx_files: bool,
    #[serde(rename = "songTitle")]
    pub song_title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub entry_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ListedFile {
    #[serde(rename = "fileName")]
    pub file_name: String,
    pub size: u64,
    #[serde(rename = "lastModified")]
    pub last_modified: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SuccessResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[cfg(test)]
#[path = "tests/models_tests.rs"]
mod tests;
