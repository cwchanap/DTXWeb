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

/// Tri-state deserializer for `Option<Option<T>>` that distinguishes an
/// absent field from an explicit `null`.
///
/// The GraphQL `updateSimfile` resolver applies `displayId`, `downloadUrl`,
/// `previewUrl`, and `videoPreviewUrl` only when the input property is
/// `!== undefined`, so an explicit `null` is a valid request to clear the
/// stored value while an omitted property means "leave unchanged". serde's
/// default `Option<Option<T>>` deserialization collapses both `null` and a
/// missing field into `None`, which would silently turn a clear request into
/// a no-op. This module maps:
///
/// - missing field (handled via `#[serde(default)]`) -> `None` (omit)
/// - `null` -> `Some(None)` (clear)
/// - value -> `Some(Some(value))` (set)
///
/// Serialization is left to serde's default `Option` impl, which emits
/// `Some(None)` as `null` and `Some(Some(v))` as `v`; the outer `None` is
/// dropped by `skip_serializing_if = "Option::is_none"`.
mod double_option {
    use serde::de::{self, Visitor};
    use serde::{Deserialize, Deserializer};
    use std::fmt;
    use std::marker::PhantomData;

    pub(crate) struct DoubleOptionVisitor<T>(PhantomData<T>);

    impl<T> DoubleOptionVisitor<T> {
        pub(crate) fn new() -> Self {
            DoubleOptionVisitor(PhantomData)
        }
    }

    impl<'de, T> Visitor<'de> for DoubleOptionVisitor<T>
    where
        T: Deserialize<'de>,
    {
        type Value = Option<Option<T>>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a nullable value or absent field")
        }

        fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(Some(None))
        }

        fn visit_some<E: Deserializer<'de>>(
            self,
            deserializer: E,
        ) -> Result<Self::Value, E::Error> {
            T::deserialize(deserializer).map(|v| Some(Some(v)))
        }

        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(Some(None))
        }
    }

    pub fn deserialize<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        T: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        deserializer.deserialize_option(DoubleOptionVisitor::<T>::new())
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
    // Tri-state: None = omit (leave unchanged), Some(None) = clear, Some(Some(_)) = set.
    // The GraphQL `updateSimfile` resolver applies displayId only when
    // `!== undefined`, so an explicit null must reach GraphQL as `null`
    // rather than being silently dropped.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "double_option::deserialize"
    )]
    #[ts(optional, type = "number | null")]
    pub display_id: Option<Option<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_published: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub publish_date: Option<String>,
    // Tri-state: see `display_id`. downloadUrl is Drive-owned when
    // `google_drive_file_id` is set, but for non-Drive records a null here
    // is a valid request to clear the stored URL.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "double_option::deserialize"
    )]
    #[ts(optional, type = "string | null")]
    pub download_url: Option<Option<String>>,
    // Tri-state: see `display_id`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "double_option::deserialize"
    )]
    #[ts(optional, type = "string | null")]
    pub video_preview_url: Option<Option<String>>,
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

#[cfg(test)]
mod tests {
    use super::double_option::DoubleOptionVisitor;
    use serde::de::value::Error;
    use serde::de::Visitor;

    #[test]
    fn double_option_treats_unit_as_clear() {
        // visit_unit maps a unit value to Some(None) (clear), matching the
        // semantics of visit_none for deserializers that represent null as
        // unit. serde_json never produces unit values, so this branch is
        // exercised directly via the visitor.
        let visitor = DoubleOptionVisitor::<i64>::new();
        let result = visitor
            .visit_unit::<Error>()
            .expect("unit is a clear request");
        assert_eq!(result, Some(None));
    }

    #[test]
    fn double_option_rejects_unexpected_type_via_expecting() {
        // An unexpected type (bool) hits the default visit_bool impl, which
        // calls Error::invalid_type → DoubleOptionVisitor::expecting. This
        // covers the expecting formatter, which serde_json never reaches for
        // an option visitor.
        let visitor = DoubleOptionVisitor::<i64>::new();
        let error = visitor
            .visit_bool::<Error>(true)
            .expect_err("bool is not a valid option value");
        assert!(
            error
                .to_string()
                .contains("a nullable value or absent field"),
            "expecting message should appear in error: {error}"
        );
    }
}
