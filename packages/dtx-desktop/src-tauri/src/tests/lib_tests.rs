use super::*;
use png::ColorType;
use std::io::Cursor;

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

#[test]
fn extract_deep_link_args_keeps_only_dtx_scheme_urls() {
    // A typical second-launch argv contains the executable path, optional
    // OS arguments, and finally the dtx:// link (if launched from a link).
    // Only the dtx:// entries should be forwarded to the auth handler.
    let argv = [
        "/usr/bin/dtx-desktop",
        "--os-flag",
        "dtx://auth-callback?magic_link=https%3A%2F%2Fexample.com",
        "some-file.dtx",
    ];

    let filtered = extract_deep_link_args(argv);
    assert_eq!(filtered.len(), 1);
    assert!(filtered[0].starts_with("dtx://auth-callback"));
}

#[test]
fn extract_deep_link_args_returns_empty_when_no_dtx_scheme_present() {
    // Plain relaunch (no deep link) — argv has only the exe path and maybe
    // file-open args. None should be forwarded to the auth handler.
    let argv = ["/usr/bin/dtx-desktop", "song.dtx"];
    assert!(extract_deep_link_args(argv).is_empty());

    let empty: [&str; 0] = [];
    assert!(extract_deep_link_args(empty).is_empty());
}

#[test]
fn extract_deep_link_args_preserves_multiple_dtx_links_in_order() {
    // Defensive: if the OS ever delivers multiple dtx:// links in a single
    // launch event, each must be dispatched (the auth handler is
    // idempotent for already-consumed magic links).
    let argv = [
        "dtx://auth-callback?magic_link=https%3A%2F%2Fa",
        "noise",
        "dtx://auth-callback?magic_link=https%3A%2F%2Fb",
    ];

    let filtered = extract_deep_link_args(argv);
    assert_eq!(filtered.len(), 2);
    assert!(filtered[0].contains("%2Fa"));
    assert!(filtered[1].contains("%2Fb"));
}

#[test]
fn extract_deep_link_args_rejects_lookalike_schemes() {
    // An attacker-controlled page can't spoof the scheme by using a
    // similar prefix like "dtx://" inside an "httpdtx://" or "dtx://"
    // substring. Only arguments that START with "dtx://" are accepted.
    let argv = [
        "httpdtx://auth-callback",
        "dtx://auth-callback?magic_link=x",
        "fdtx://other",
    ];

    let filtered = extract_deep_link_args(argv);
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0], "dtx://auth-callback?magic_link=x");
}

#[test]
fn extract_deep_link_args_accepts_case_insensitive_scheme() {
    // RFC 3986 makes the URI scheme case-insensitive, so an OS that delivers
    // `DTX://` (or any mixed-case variant) must be treated the same as the
    // canonical `dtx://` form. The original casing is preserved so the auth
    // handler sees the URL exactly as delivered.
    let argv = [
        "DTX://auth-callback?magic_link=upper",
        "Dtx://auth-callback?magic_link=mixed",
        "noise",
    ];

    let filtered = extract_deep_link_args(argv);
    assert_eq!(filtered.len(), 2);
    assert_eq!(filtered[0], "DTX://auth-callback?magic_link=upper");
    assert_eq!(filtered[1], "Dtx://auth-callback?magic_link=mixed");
}
