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

/// Verifies that `ReadFileResultWire` produces the same JSON as `ReadFileResult`
/// for every variant, so the generated TypeScript types stay in sync with the
/// actual wire format.
#[test]
fn read_file_result_wire_matches_read_file_result_serialization() {
    let error = ReadFileResult::Error {
        error: "boom".to_string(),
    };
    let wire_error = ReadFileResultWire::Error {
        error: "boom".to_string(),
        content: String::new(),
    };
    assert_eq!(
        serde_json::to_value(error).expect("serialize"),
        serde_json::to_value(wire_error).expect("serialize")
    );

    let text = ReadFileResult::Text {
        content: "hello".to_string(),
    };
    let wire_text = ReadFileResultWire::Text {
        error: None,
        content: "hello".to_string(),
    };
    assert_eq!(
        serde_json::to_value(text).expect("serialize"),
        serde_json::to_value(wire_text).expect("serialize")
    );

    let binary = ReadFileResult::Binary {
        content: vec![0, 1],
    };
    let wire_binary = ReadFileResultWire::Binary {
        error: None,
        content: vec![0, 1],
    };
    assert_eq!(
        serde_json::to_value(binary).expect("serialize"),
        serde_json::to_value(wire_binary).expect("serialize")
    );
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
