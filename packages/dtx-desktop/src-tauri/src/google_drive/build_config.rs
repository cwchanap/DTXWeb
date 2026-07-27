#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopBuildEnvironment {
    Production,
    Preproduction,
    Local,
    E2e,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DriveBuildMode {
    Disabled,
    Real {
        environment: DesktopBuildEnvironment,
        oauth_client_id: String,
    },
    FakeE2e,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct DriveBuildConfigInput<'a> {
    pub(crate) google_drive_feature: bool,
    pub(crate) e2e_feature: bool,
    pub(crate) debug_assertions: bool,
    pub(crate) declared_environment: Option<&'a str>,
    pub(crate) oauth_client_id: Option<&'a str>,
    pub(crate) oauth_client_environment: Option<&'a str>,
}

pub(crate) fn parse_drive_build_mode(
    input: DriveBuildConfigInput<'_>,
) -> Result<DriveBuildMode, String> {
    if input.google_drive_feature && input.e2e_feature {
        return Err(drive_configuration_error(
            "the e2e build must use --no-default-features --features e2e",
        ));
    }
    if !input.google_drive_feature {
        return parse_without_google_drive(input);
    }

    let environment = parse_environment(input.declared_environment)?;
    let Some(environment) = environment else {
        return Ok(DriveBuildMode::Disabled);
    };

    if environment == DesktopBuildEnvironment::E2e {
        return Err(drive_configuration_error(
            "the e2e build must use --no-default-features --features e2e",
        ));
    }

    let oauth_client_id = required_oauth_client_id(input.oauth_client_id)?;
    let client_environment =
        parse_environment(input.oauth_client_environment)?.ok_or_else(|| {
            drive_configuration_error(
                "GOOGLE_DRIVE_OAUTH_CLIENT_ENV must match DTX_DESKTOP_BUILD_ENV",
            )
        })?;
    if client_environment != environment {
        return Err(drive_configuration_error(
            "GOOGLE_DRIVE_OAUTH_CLIENT_ENV must match DTX_DESKTOP_BUILD_ENV",
        ));
    }

    Ok(DriveBuildMode::Real {
        environment,
        oauth_client_id,
    })
}

fn parse_without_google_drive(input: DriveBuildConfigInput<'_>) -> Result<DriveBuildMode, String> {
    let environment = parse_environment(input.declared_environment)?;
    if environment != Some(DesktopBuildEnvironment::E2e) {
        return Ok(DriveBuildMode::Disabled);
    }

    if !input.e2e_feature {
        return Err(drive_configuration_error(
            "DTX_DESKTOP_BUILD_ENV=e2e requires the e2e feature",
        ));
    }
    if !input.debug_assertions {
        return Err(drive_configuration_error(
            "DTX_DESKTOP_BUILD_ENV=e2e requires a profile with debug assertions",
        ));
    }
    if has_value(input.oauth_client_id) || has_value(input.oauth_client_environment) {
        return Err(drive_configuration_error(
            "DTX_DESKTOP_BUILD_ENV=e2e must not receive an OAuth client",
        ));
    }

    Ok(DriveBuildMode::FakeE2e)
}

fn parse_environment(value: Option<&str>) -> Result<Option<DesktopBuildEnvironment>, String> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some("production") => Ok(Some(DesktopBuildEnvironment::Production)),
        Some("preproduction") => Ok(Some(DesktopBuildEnvironment::Preproduction)),
        Some("local") => Ok(Some(DesktopBuildEnvironment::Local)),
        Some("e2e") => Ok(Some(DesktopBuildEnvironment::E2e)),
        Some(value) => Err(drive_configuration_error(&format!(
            "DTX_DESKTOP_BUILD_ENV has unsupported value {value:?}"
        ))),
    }
}

fn required_oauth_client_id(value: Option<&str>) -> Result<String, String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            drive_configuration_error(
                "a real Drive build requires a non-empty GOOGLE_DRIVE_OAUTH_CLIENT_ID",
            )
        })
}

fn has_value(value: Option<&str>) -> bool {
    value.is_some_and(|value| !value.trim().is_empty())
}

fn drive_configuration_error(detail: &str) -> String {
    format!("Invalid Google Drive configuration: {detail}")
}

#[cfg(test)]
#[path = "../tests/google_drive_build_config_tests.rs"]
mod tests;
