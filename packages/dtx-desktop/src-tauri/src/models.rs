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
                    error: &'a str,
                    content: &'a str,
                }

                ErrorResult { error, content }.serialize(serializer)
            }
            Self::Text { error, content } => {
                #[derive(Serialize)]
                struct TextResult<'a> {
                    error: &'a Option<String>,
                    content: &'a str,
                    #[serde(rename = "isText")]
                    is_text: bool,
                }

                TextResult {
                    error,
                    content,
                    is_text: true,
                }
                .serialize(serializer)
            }
            Self::Binary { error, content } => {
                #[derive(Serialize)]
                struct BinaryResult<'a> {
                    error: &'a Option<String>,
                    content: &'a [u8],
                    #[serde(rename = "isText")]
                    is_text: bool,
                }

                BinaryResult {
                    error,
                    content,
                    is_text: false,
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
mod tests {
    use super::*;

    #[test]
    fn read_file_text_serializes_renderer_shape() {
        let result = ReadFileResult::Text {
            error: None,
            content: "#TITLE: Song".to_string(),
        };

        let json = serde_json::to_value(result).expect("serializes");
        assert_eq!(json["error"], serde_json::Value::Null);
        assert_eq!(json["content"], "#TITLE: Song");
        assert_eq!(json["isText"], true);
    }

    #[test]
    fn read_file_error_serializes_without_is_text() {
        // The Error variant intentionally omits the isText field that Text and
        // Binary include. This documents that structural difference so the
        // renderer can rely on it (e.g. treating a missing isText as an error).
        let result = ReadFileResult::Error {
            error: "File type not allowed".to_string(),
            content: String::new(),
        };

        let json = serde_json::to_value(result).expect("serializes");
        assert_eq!(json["error"], "File type not allowed");
        assert_eq!(json["content"], "");
        assert!(json.get("isText").is_none());
    }

    #[test]
    fn read_file_binary_serializes_renderer_shape() {
        let result = ReadFileResult::Binary {
            error: None,
            content: vec![1, 2, 3],
        };

        let json = serde_json::to_value(result).expect("serializes");
        assert_eq!(json["error"], serde_json::Value::Null);
        assert_eq!(json["content"], serde_json::json!([1, 2, 3]));
        assert_eq!(json["isText"], false);
    }

    #[test]
    fn success_result_omits_absent_error() {
        let result = SuccessResult {
            success: true,
            error: None,
        };

        let json = serde_json::to_value(result).expect("serializes");
        assert_eq!(json["success"], true);
        assert_eq!(json.get("error"), None);
    }
}
