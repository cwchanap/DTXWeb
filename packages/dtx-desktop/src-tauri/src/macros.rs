/// Reads a public configuration value, preferring the value baked into the
/// binary at build time and falling back to the runtime environment.
///
/// The packaged Tauri binary does not inherit the build machine's environment,
/// so public configuration such as `PUBLIC_SUPABASE_URL` must be captured with
/// `option_env!` at compile time. The runtime `std::env::var` fallback keeps
/// `tauri dev` (which loads `.env`) and ad-hoc overrides working. Empty/blank
/// values are treated as missing so a stray empty string is never used.
macro_rules! config_env {
	($name:literal) => {
		::std::option_env!($name)
			.map(::std::string::ToString::to_string)
			.or_else(|| ::std::env::var($name).ok())
			.filter(|value| !value.trim().is_empty())
	};
}
