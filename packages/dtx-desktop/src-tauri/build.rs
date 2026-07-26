#[path = "src/google_drive/build_config.rs"]
mod google_drive_build_config;

use google_drive_build_config::{parse_drive_build_mode, DriveBuildConfigInput};

const CONFIG_ENVIRONMENT_VARIABLES: [&str; 5] = [
    "CARGO_FEATURE_GOOGLE_DRIVE",
    "CARGO_FEATURE_E2E",
    "PROFILE",
    "DTX_DESKTOP_BUILD_ENV",
    "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
];

fn main() {
    for variable in CONFIG_ENVIRONMENT_VARIABLES {
        println!("cargo:rerun-if-env-changed={variable}");
    }
    println!("cargo:rerun-if-env-changed=GOOGLE_DRIVE_OAUTH_CLIENT_ENV");

    let declared_environment = std::env::var("DTX_DESKTOP_BUILD_ENV").ok();
    let oauth_client_id = std::env::var("GOOGLE_DRIVE_OAUTH_CLIENT_ID").ok();
    let oauth_client_environment = std::env::var("GOOGLE_DRIVE_OAUTH_CLIENT_ENV").ok();

    parse_drive_build_mode(DriveBuildConfigInput {
        google_drive_feature: environment_is_set("CARGO_FEATURE_GOOGLE_DRIVE"),
        e2e_feature: environment_is_set("CARGO_FEATURE_E2E"),
        debug_assertions: std::env::var("PROFILE").as_deref() == Ok("debug"),
        declared_environment: declared_environment.as_deref(),
        oauth_client_id: oauth_client_id.as_deref(),
        oauth_client_environment: oauth_client_environment.as_deref(),
    })
    .unwrap_or_else(|error| panic!("{error}"));

    tauri_build::build();
}

fn environment_is_set(name: &str) -> bool {
    std::env::var_os(name).is_some()
}
