use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogResult {
    pub canceled: bool,
    #[serde(rename = "filePaths")]
    pub file_paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
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

/// TypeScript wire-format mirror of `ReadFileResult`. This enum uses
/// `#[serde(tag = "kind")]` so its serialization matches the custom `Serialize`
/// impl on `ReadFileResult` exactly (all three fields present in every variant).
/// A test in `tests/models_tests.rs` verifies the two stay in sync.
#[allow(dead_code)] // used by ts-rs codegen and tests, not runtime
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind")]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub enum ReadFileResultWire {
    #[serde(rename = "error")]
    Error { error: String, content: String },
    #[serde(rename = "text")]
    Text {
        error: Option<String>,
        content: String,
    },
    #[serde(rename = "binary")]
    Binary {
        error: Option<String>,
        content: Vec<u8>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
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

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct ListedFile {
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[ts(type = "number")]
    pub size: u64,
    #[serde(rename = "lastModified")]
    pub last_modified: String,
    pub key: String,
}

/// Wire format for the `list_files` command. `list_directory` produces the
/// same `{ files, error }` shape but still constructs it inline via `json!`,
/// so this struct is currently the canonical definition only for `list_files`.
/// The generated TypeScript mirror (via ts-rs) is consumed by the e2e-desktop
/// support layer, not the production desktop frontend, which defines its own
/// hand-written types in `desktopHost.ts`.
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct ListFilesResult {
    pub files: Vec<ListedFile>,
    pub error: Option<String>,
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub enum E2eExistingFileFailure {
    None,
    NotFound,
    PermissionDenied,
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct E2eDriveOwnerSeed {
    pub simfile_id: String,
    pub cloud_title: String,
    pub google_drive_file_id: Option<String>,
    pub download_url: Option<String>,
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct E2eDriveControl {
    pub reset: bool,
    pub owner: Option<E2eDriveOwnerSeed>,
    pub existing_file_failure: E2eExistingFileFailure,
    pub public_permission: Option<bool>,
    pub terminate_before_metadata_patch: Option<bool>,
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct E2eDriveZipEntrySnapshot {
    pub name: String,
    #[ts(type = "number")]
    pub size: u64,
    pub sha256: String,
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct E2eDriveObjectSnapshot {
    pub file_id: String,
    pub name: String,
    pub web_content_link: String,
    pub zip_entries: Vec<E2eDriveZipEntrySnapshot>,
    #[ts(type = "number")]
    pub creation_count: u64,
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct E2eDriveCallSnapshot {
    pub operation: String,
    pub file_id: Option<String>,
    pub name: Option<String>,
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct E2eDriveMetadataMutationSnapshot {
    pub mutation: String,
    pub simfile_id: String,
    pub drive_file_id: String,
    pub download_url: String,
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct E2eDriveProgressSnapshot {
    pub operation_id: String,
    pub simfile_id: String,
    pub stage: String,
    #[ts(type = "number | null")]
    pub bytes_uploaded: Option<u64>,
    #[ts(type = "number | null")]
    pub total_bytes: Option<u64>,
    pub percentage: Option<u8>,
    pub error_code: Option<String>,
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../../e2e-desktop/support/generated/native-types.ts"
)]
pub struct E2eDriveSnapshot {
    pub owner: E2eDriveOwnerSeed,
    pub objects: Vec<E2eDriveObjectSnapshot>,
    pub calls: Vec<E2eDriveCallSnapshot>,
    pub metadata_mutations: Vec<E2eDriveMetadataMutationSnapshot>,
    pub progress: Vec<E2eDriveProgressSnapshot>,
    #[ts(type = "number")]
    pub generate_count: u64,
    #[ts(type = "number")]
    pub create_count: u64,
    #[ts(type = "number")]
    pub update_count: u64,
    #[ts(type = "number")]
    pub delete_count: u64,
    #[ts(type = "number")]
    pub lifetime_create_count: u64,
    pub public_permission: bool,
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
