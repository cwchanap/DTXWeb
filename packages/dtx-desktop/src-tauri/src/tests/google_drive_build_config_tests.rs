use super::{
    parse_drive_build_mode, DesktopBuildEnvironment, DriveBuildConfigInput, DriveBuildMode,
};

fn input() -> DriveBuildConfigInput<'static> {
    DriveBuildConfigInput {
        google_drive_feature: true,
        e2e_feature: false,
        debug_assertions: true,
        declared_environment: Some("local"),
        oauth_client_id: Some("local-client.apps.googleusercontent.com"),
        oauth_client_environment: Some("local"),
    }
}

#[test]
fn disables_drive_when_the_google_drive_feature_is_not_enabled() {
    let mut config = input();
    config.google_drive_feature = false;

    assert_eq!(parse_drive_build_mode(config), Ok(DriveBuildMode::Disabled));
}

#[test]
fn disables_drive_when_no_desktop_build_environment_is_declared() {
    let mut config = input();
    config.declared_environment = None;
    config.oauth_client_id = None;
    config.oauth_client_environment = None;

    assert_eq!(parse_drive_build_mode(config), Ok(DriveBuildMode::Disabled));
}

#[test]
fn maps_each_declared_real_environment_to_its_matching_client() {
    for (declared_environment, environment) in [
        ("production", DesktopBuildEnvironment::Production),
        ("preproduction", DesktopBuildEnvironment::Preproduction),
        ("local", DesktopBuildEnvironment::Local),
    ] {
        let mut config = input();
        config.declared_environment = Some(declared_environment);
        config.oauth_client_environment = Some(declared_environment);

        assert_eq!(
            parse_drive_build_mode(config),
            Ok(DriveBuildMode::Real {
                environment,
                oauth_client_id: "local-client.apps.googleusercontent.com".to_string(),
            })
        );
    }
}

#[test]
fn maps_e2e_to_a_fake_build_only_without_a_client() {
    let mut config = input();
    config.google_drive_feature = false;
    config.e2e_feature = true;
    config.declared_environment = Some("e2e");
    config.oauth_client_id = None;
    config.oauth_client_environment = None;

    assert_eq!(parse_drive_build_mode(config), Ok(DriveBuildMode::FakeE2e));
}

#[test]
fn rejects_a_blank_oauth_client_id_for_a_real_drive_build() {
    let mut config = input();
    config.oauth_client_id = Some("   ");

    let error = parse_drive_build_mode(config).expect_err("blank client ID must not enable Drive");
    assert!(error.contains("GOOGLE_DRIVE_OAUTH_CLIENT_ID"));
}

#[test]
fn rejects_a_missing_oauth_client_id_for_a_real_drive_build() {
    let mut config = input();
    config.oauth_client_id = None;

    let error =
        parse_drive_build_mode(config).expect_err("missing client ID must not enable Drive");
    assert!(error.contains("GOOGLE_DRIVE_OAUTH_CLIENT_ID"));
}

#[test]
fn rejects_a_client_environment_marker_that_differs_from_the_build_environment() {
    let mut config = input();
    config.oauth_client_environment = Some("preproduction");

    assert!(parse_drive_build_mode(config).is_err());
}

#[test]
fn rejects_e2e_without_the_e2e_feature() {
    let mut config = input();
    config.google_drive_feature = false;
    config.declared_environment = Some("e2e");
    config.oauth_client_id = None;
    config.oauth_client_environment = None;

    assert!(parse_drive_build_mode(config).is_err());
}

#[test]
fn rejects_e2e_without_debug_assertions() {
    let mut config = input();
    config.google_drive_feature = false;
    config.e2e_feature = true;
    config.debug_assertions = false;
    config.declared_environment = Some("e2e");
    config.oauth_client_id = None;
    config.oauth_client_environment = None;

    assert!(parse_drive_build_mode(config).is_err());
}

#[test]
fn rejects_a_production_client_in_a_preproduction_declaration() {
    let mut config = input();
    config.declared_environment = Some("preproduction");
    config.oauth_client_environment = Some("production");

    assert!(parse_drive_build_mode(config).is_err());
}

#[test]
fn rejects_a_real_oauth_client_in_e2e() {
    let mut config = input();
    config.google_drive_feature = false;
    config.e2e_feature = true;
    config.declared_environment = Some("e2e");

    assert!(parse_drive_build_mode(config).is_err());
}

#[test]
fn rejects_selecting_the_fake_alongside_the_real_drive_feature() {
    let mut config = input();
    config.e2e_feature = true;
    config.declared_environment = Some("e2e");
    config.oauth_client_id = None;
    config.oauth_client_environment = None;

    assert!(parse_drive_build_mode(config).is_err());
}
