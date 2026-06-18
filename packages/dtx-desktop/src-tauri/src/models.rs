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

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum ReadFileResult {
    Error {
        error: String,
        content: String,
    },
    Text {
        error: Option<String>,
        content: String,
    },
    Binary {
        error: Option<String>,
        content: Vec<u8>,
    },
}

impl Serialize for ReadFileResult {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Error { error, content } => {
                #[derive(Serialize)]
                struct ErrorResult<'a> {
                    kind: &'static str,
                    error: &'a str,
                    content: &'a str,
                }

                ErrorResult {
                    kind: "error",
                    error,
                    content,
                }
                .serialize(serializer)
            }
            Self::Text { error, content } => {
                #[derive(Serialize)]
                struct TextResult<'a> {
                    kind: &'static str,
                    error: &'a Option<String>,
                    content: &'a str,
                }

                TextResult {
                    kind: "text",
                    error,
                    content,
                }
                .serialize(serializer)
            }
            Self::Binary { error, content } => {
                #[derive(Serialize)]
                struct BinaryResult<'a> {
                    kind: &'static str,
                    error: &'a Option<String>,
                    content: &'a [u8],
                }

                BinaryResult {
                    kind: "binary",
                    error,
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
