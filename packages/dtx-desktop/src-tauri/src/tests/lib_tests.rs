use png::ColorType;
use std::io::Cursor;

#[test]
fn workspace_state_persists_under_the_native_data_directory() {
    let data_dir = tempfile::tempdir().expect("data dir");

    assert_eq!(
        crate::workspace::workspace_settings_path(data_dir.path()),
        data_dir.path().join("dtxweb").join("workspace.json")
    );
}

#[test]
fn app_icon_decodes_to_non_empty_rgba_pixels() {
    let decoder = png::Decoder::new(Cursor::new(include_bytes!("../../icons/icon.png")));
    let mut reader = decoder.read_info().expect("app icon should decode");
    let output_size = reader
        .output_buffer_size()
        .expect("app icon output buffer size should be known");
    let mut pixels = vec![0; output_size];
    let frame = reader
        .next_frame(&mut pixels)
        .expect("app icon should have a readable frame");

    assert!(
        frame.width >= 512,
        "app icon should be high-resolution enough for desktop packaging"
    );
    assert!(
        frame.height >= 512,
        "app icon should be high-resolution enough for desktop packaging"
    );
    assert!(
        frame.buffer_size() > 0,
        "app icon should decode to non-empty pixel data"
    );

    assert_eq!(
        reader.info().color_type,
        ColorType::Rgba,
        "app icon should include an alpha channel"
    );

    let corners = [
        3,
        ((frame.width as usize - 1) * 4) + 3,
        (((frame.height as usize - 1) * frame.width as usize) * 4) + 3,
        (((frame.height as usize * frame.width as usize) - 1) * 4) + 3,
    ];
    for alpha_index in corners {
        assert_eq!(
            pixels[alpha_index], 0,
            "app icon corners should be transparent"
        );
    }
}
