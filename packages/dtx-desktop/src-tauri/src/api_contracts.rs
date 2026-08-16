use serde::{Deserialize, Serialize};
use ts_rs::TS;

mod f64_as_number {
    use serde::Serializer;

    pub fn serialize<S>(value: &f64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if value.is_finite()
            && value.fract() == 0.0
            && *value >= i64::MIN as f64
            && *value < i64::MAX as f64
        {
            serializer.serialize_i64(*value as i64)
        } else {
            serializer.serialize_f64(*value)
        }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct NativeSimfileDtxFile {
    #[ts(type = "number")]
    pub id: i64,
    pub label: String,
    #[serde(with = "f64_as_number")]
    #[ts(type = "number")]
    pub level: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct NativeSimfile {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number | null")]
    pub display_id: Option<i64>,
    pub title: String,
    pub artist: String,
    #[serde(with = "f64_as_number")]
    #[ts(type = "number")]
    pub bpm: f64,
    pub user_id: Option<String>,
    pub google_drive_file_id: Option<String>,
    pub is_published: bool,
    pub download_url: Option<String>,
    pub preview_url: Option<String>,
    pub video_preview_url: Option<String>,
    pub publish_date: String,
    pub created_at: String,
    pub updated_at: String,
    pub dtx_files: Vec<NativeSimfileDtxFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct CreateSimfileLevelInput {
    pub label: String,
    pub level: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct CreateSimfileRecordInput {
    pub title: String,
    pub artist: String,
    pub bpm: f64,
    #[ts(type = "number | null")]
    pub display_id: Option<i64>,
    pub is_published: bool,
    pub publish_date: String,
    pub download_url: String,
    pub video_preview_url: String,
    pub levels: Vec<CreateSimfileLevelInput>,
    pub song_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct UpdateSimfileRecordInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bpm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub display_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_published: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub publish_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub video_preview_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct FetchUserSimfilesResult {
    pub success: bool,
    pub data: Vec<NativeSimfile>,
    pub from_cache: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct FetchCloudSongResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cloud_song_data: Option<NativeSimfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct CreateSimfileRecordResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub simfile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub data: Option<NativeSimfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub warnings: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct UpdateSimfileRecordResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub data: Option<NativeSimfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}
