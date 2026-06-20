use super::*;

#[test]
fn read_file_text_serializes_renderer_shape() {
    let result = ReadFileResult::Text {
        content: "#TITLE: Song".to_string(),
    };

    let json = serde_json::to_value(result).expect("serializes");
    assert_eq!(json["kind"], "text");
    assert_eq!(json["error"], serde_json::Value::Null);
    assert_eq!(json["content"], "#TITLE: Song");
}

#[test]
fn read_file_error_serializes_with_kind_tag() {
    let result = ReadFileResult::Error {
        error: "File type not allowed".to_string(),
    };

    let json = serde_json::to_value(result).expect("serializes");
    assert_eq!(json["kind"], "error");
    assert_eq!(json["error"], "File type not allowed");
    assert_eq!(json["content"], "");
}

#[test]
fn read_file_binary_serializes_renderer_shape() {
    let result = ReadFileResult::Binary {
        content: vec![1, 2, 3],
    };

    let json = serde_json::to_value(result).expect("serializes");
    assert_eq!(json["kind"], "binary");
    assert_eq!(json["error"], serde_json::Value::Null);
    assert_eq!(json["content"], serde_json::json!([1, 2, 3]));
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
