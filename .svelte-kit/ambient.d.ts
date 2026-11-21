
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/private';
 * 
 * console.log(ENVIRONMENT); // => "production"
 * console.log(PUBLIC_BASE_URL); // => throws error during build
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/private' {
	export const SHELL: string;
	export const fish_history: string;
	export const COLORTERM: string;
	export const ORCA_USER_DATA: string;
	export const TERM_PROGRAM_VERSION: string;
	export const CHISEL_SESSION_DB: string;
	export const ORCA_IMAGE_PROTOCOL: string;
	export const ORCA_AGENT_HOOK_ENDPOINT: string;
	export const ORCA_AGENT_HOOK_TOKEN: string;
	export const FORCE_HYPERLINK: string;
	export const ORCA_CLI_BIN_DIR: string;
	export const POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD: string;
	export const ORCA_WORKTREE_ID: string;
	export const PWD: string;
	export const LOGNAME: string;
	export const ORCA_RUNTIME_SOURCE_INCARNATION: string;
	export const ORCA_AGENT_HOOK_VERSION: string;
	export const HOME: string;
	export const SSH_ASKPASS: string;
	export const LANG: string;
	export const ORCA_CLAUDE_AGENT_VIEW_PLUGIN_DIR: string;
	export const __MISE_DIFF: string;
	export const ORCA_PANE_KEY: string;
	export const ORCA_APP_VERSION: string;
	export const GIT_ASKPASS: string;
	export const ORCA_CLAUDE_CONFIG_DIR: string;
	export const SSH_CONNECTION: string;
	export const JCODE_RUNTIME_DIR: string;
	export const PI_CLIPBOARD_OSC52: string;
	export const ORCA_PI_SOURCE_AGENT_DIR: string;
	export const __MISE_ORIG_PATH: string;
	export const DEVIN_TRACEPARENT: string;
	export const ORCA_TERMINAL_HANDLE: string;
	export const TERM: string;
	export const ORCA_RUNTIME_SOURCE_PROFILE_PATH: string;
	export const USER: string;
	export const ORCA_AGENT_LAUNCH_TOKEN: string;
	export const ORCA_AGENT_HOOK_ENV: string;
	export const __MISE_SESSION: string;
	export const DISPLAY: string;
	export const ORCA_TAB_ID: string;
	export const SHLVL: string;
	export const ORCA_OPENCODE_AGENT: string;
	export const ORCA_AGENT_HOOK_PORT: string;
	export const ORCA_AGENT_HOOK_TRANSPORT: string;
	export const ORCA_REMOTE_VIEWER_CLIPBOARD: string;
	export const LIBGL_ALWAYS_SOFTWARE: string;
	export const ORCA_WORKSPACE_ID: string;
	export const ORCA_AGENT_PANE: string;
	export const SSH_CLIENT: string;
	export const DEBUGINFOD_IMA_CERT_PATH: string;
	export const GCM_INTERACTIVE: string;
	export const ORCA_AGENT_HOOK_OPENCODE_TUI: string;
	export const ORCA_AGENT_LAUNCH: string;
	export const CLAUDE_CODE_PLUGIN_DIRS: string;
	export const MISE_SHELL: string;
	export const BROWSER: string;
	export const PATH: string;
	export const DBUS_SESSION_BUS_ADDRESS: string;
	export const ORCA_VERSION: string;
	export const ORCA_USER_DATA_PATH: string;
	export const ORCA_CLAUDE_PROFILE_POINTER: string;
	export const GIT_TERMINAL_PROMPT: string;
	export const ORCA_RUNTIME_SOURCE_ID: string;
	export const OLDPWD: string;
	export const TERM_PROGRAM: string;
	export const ORCA_CLI_COMMAND: string;
	export const _: string;
	export const npm_config_local_prefix: string;
	export const npm_config_user_agent: string;
	export const npm_execpath: string;
	export const npm_package_name: string;
	export const npm_package_json: string;
	export const npm_package_version: string;
	export const NODE: string;
	export const npm_node_execpath: string;
	export const npm_command: string;
	export const npm_lifecycle_event: string;
	export const npm_lifecycle_script: string;
	export const TEST: string;
	export const VITEST: string;
	export const NODE_ENV: string;
}

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/public';
 * 
 * console.log(ENVIRONMENT); // => throws error during build
 * console.log(PUBLIC_BASE_URL); // => "http://site.com"
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * 
 * console.log(env.ENVIRONMENT); // => "production"
 * console.log(env.PUBLIC_BASE_URL); // => undefined
 * ```
 */
declare module '$env/dynamic/private' {
	export const env: {
		SHELL: string;
		fish_history: string;
		COLORTERM: string;
		ORCA_USER_DATA: string;
		TERM_PROGRAM_VERSION: string;
		CHISEL_SESSION_DB: string;
		ORCA_IMAGE_PROTOCOL: string;
		ORCA_AGENT_HOOK_ENDPOINT: string;
		ORCA_AGENT_HOOK_TOKEN: string;
		FORCE_HYPERLINK: string;
		ORCA_CLI_BIN_DIR: string;
		POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD: string;
		ORCA_WORKTREE_ID: string;
		PWD: string;
		LOGNAME: string;
		ORCA_RUNTIME_SOURCE_INCARNATION: string;
		ORCA_AGENT_HOOK_VERSION: string;
		HOME: string;
		SSH_ASKPASS: string;
		LANG: string;
		ORCA_CLAUDE_AGENT_VIEW_PLUGIN_DIR: string;
		__MISE_DIFF: string;
		ORCA_PANE_KEY: string;
		ORCA_APP_VERSION: string;
		GIT_ASKPASS: string;
		ORCA_CLAUDE_CONFIG_DIR: string;
		SSH_CONNECTION: string;
		JCODE_RUNTIME_DIR: string;
		PI_CLIPBOARD_OSC52: string;
		ORCA_PI_SOURCE_AGENT_DIR: string;
		__MISE_ORIG_PATH: string;
		DEVIN_TRACEPARENT: string;
		ORCA_TERMINAL_HANDLE: string;
		TERM: string;
		ORCA_RUNTIME_SOURCE_PROFILE_PATH: string;
		USER: string;
		ORCA_AGENT_LAUNCH_TOKEN: string;
		ORCA_AGENT_HOOK_ENV: string;
		__MISE_SESSION: string;
		DISPLAY: string;
		ORCA_TAB_ID: string;
		SHLVL: string;
		ORCA_OPENCODE_AGENT: string;
		ORCA_AGENT_HOOK_PORT: string;
		ORCA_AGENT_HOOK_TRANSPORT: string;
		ORCA_REMOTE_VIEWER_CLIPBOARD: string;
		LIBGL_ALWAYS_SOFTWARE: string;
		ORCA_WORKSPACE_ID: string;
		ORCA_AGENT_PANE: string;
		SSH_CLIENT: string;
		DEBUGINFOD_IMA_CERT_PATH: string;
		GCM_INTERACTIVE: string;
		ORCA_AGENT_HOOK_OPENCODE_TUI: string;
		ORCA_AGENT_LAUNCH: string;
		CLAUDE_CODE_PLUGIN_DIRS: string;
		MISE_SHELL: string;
		BROWSER: string;
		PATH: string;
		DBUS_SESSION_BUS_ADDRESS: string;
		ORCA_VERSION: string;
		ORCA_USER_DATA_PATH: string;
		ORCA_CLAUDE_PROFILE_POINTER: string;
		GIT_TERMINAL_PROMPT: string;
		ORCA_RUNTIME_SOURCE_ID: string;
		OLDPWD: string;
		TERM_PROGRAM: string;
		ORCA_CLI_COMMAND: string;
		_: string;
		npm_config_local_prefix: string;
		npm_config_user_agent: string;
		npm_execpath: string;
		npm_package_name: string;
		npm_package_json: string;
		npm_package_version: string;
		NODE: string;
		npm_node_execpath: string;
		npm_command: string;
		npm_lifecycle_event: string;
		npm_lifecycle_script: string;
		TEST: string;
		VITEST: string;
		NODE_ENV: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://example.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.ENVIRONMENT); // => undefined, not public
 * console.log(env.PUBLIC_BASE_URL); // => "http://example.com"
 * ```
 * 
 * ```
 * 
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
