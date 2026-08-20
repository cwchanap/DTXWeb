import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { DTX_API_LOCAL_PORT, isAuthConfigured } from './test-config';

// CI guard: fail loudly when auth secrets are not provisioned. Without this,
// Playwright exits 0 with zero auth-test coverage — the gate is then
// unenforced, invisibly.
if (process.env.CI && !isAuthConfigured) {
	throw new Error(
		'CI requires Better Auth e2e credentials (E2E_USER_PASSWORD, E2E_USER_EMAIL) ' +
			'to be set. The authenticated lifecycle test is the core of the gate.'
	);
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const apiURL = `http://localhost:${DTX_API_LOCAL_PORT}`;
const packageRoot = fileURLToPath(new URL('.', import.meta.url));

// Playwright's TestConfigWebServer.env requires Record<string, string>, but
// process.env types values as string | undefined. Strip undefined entries.
const processEnv = Object.fromEntries(
	Object.entries(process.env).filter(([, value]) => value !== undefined)
) as Record<string, string>;

const localAuthEnv = {
	BETTER_AUTH_URL: apiURL,
	BETTER_AUTH_SECRET:
		process.env.BETTER_AUTH_SECRET ?? 'e2e-local-better-auth-secret-0123456789abcdef',
	BETTER_AUTH_DEVICE_CODE_EXPIRES_IN: '1s',
	DTX_WEB_URL: baseURL,
	AUTH_COOKIE_DOMAIN: '',
	AUTH_COOKIE_PREFIX: 'dtx-local',
	GOOGLE_AUTH_CLIENT_ID: 'e2e-local-google-client-id',
	GOOGLE_AUTH_CLIENT_SECRET: 'e2e-local-google-client-secret'
};

// dtx-web serves with dtx-api as the single backend; dtx-api is seeded +
// booted for e2e. No REST proxy leg remains after Phase 6.
const webServers = [
	{
		command: 'bun run --filter=dtx-web dev',
		cwd: packageRoot,
		url: 'http://localhost:5173',
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			...processEnv,
			VITE_E2E: 'true',
			PUBLIC_DTX_API_URL: apiURL,
			PUBLIC_SIMFILE_BUCKET_URL: process.env.PUBLIC_SIMFILE_BUCKET_URL ?? baseURL,
			PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true'
		}
	},
	{
		command:
			'bun run setup/prepare-stack.ts && ' +
			'cd ../dtx-api && bunx wrangler dev --port ' +
			DTX_API_LOCAL_PORT +
			' --persist-to .wrangler/state' +
			` --var BETTER_AUTH_URL:"${localAuthEnv.BETTER_AUTH_URL}"` +
			` --var BETTER_AUTH_SECRET:"${localAuthEnv.BETTER_AUTH_SECRET}"` +
			` --var BETTER_AUTH_DEVICE_CODE_EXPIRES_IN:"${localAuthEnv.BETTER_AUTH_DEVICE_CODE_EXPIRES_IN}"` +
			` --var DTX_WEB_URL:"${localAuthEnv.DTX_WEB_URL}"` +
			' --var AUTH_COOKIE_DOMAIN:' +
			` --var AUTH_COOKIE_PREFIX:"${localAuthEnv.AUTH_COOKIE_PREFIX}"` +
			` --var GOOGLE_AUTH_CLIENT_ID:"${localAuthEnv.GOOGLE_AUTH_CLIENT_ID}"` +
			` --var GOOGLE_AUTH_CLIENT_SECRET:"${localAuthEnv.GOOGLE_AUTH_CLIENT_SECRET}"` +
			' --var CORS_ALLOWED_ORIGINS:"http://localhost:5173"' +
			' --var PUBLIC_ENABLE_BLOG_DOWNLOAD:"true"',
		cwd: packageRoot,
		url: `${apiURL}/graphql?query=%7B__typename%7D`,
		reuseExistingServer: false,
		timeout: 180_000,
		env: { ...processEnv }
	}
];

export default defineConfig({
	testDir: '.',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: { baseURL, trace: 'on-first-retry' },
	projects: [
		// Non-auth specs always run — they have no setup dependency.
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
			testIgnore: [/global\.setup\.ts/, /auth-lifecycle\.spec\.ts/, /score\.spec\.ts/]
		},
		// Auth-dependent projects are included only when credentials are configured.
		...(isAuthConfigured
			? [
					{ name: 'setup', testMatch: /global\.setup\.ts/ },
					{
						name: 'chromium-auth',
						use: { ...devices['Desktop Chrome'] },
						testMatch:
							/auth-lifecycle\.spec\.ts|device-authorization\.spec\.ts|score\.spec\.ts/,
						dependencies: ['setup']
					}
				]
			: [])
	],
	webServer: webServers
});
