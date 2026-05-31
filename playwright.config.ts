import { defineConfig, devices } from '@playwright/test';
import {
	TEST_SUPABASE_URL,
	TEST_SUPABASE_ANON_KEY,
	DTX_API_LOCAL_PORT,
	isAuthConfigured
} from './e2e/test-config';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const useGraphQL = process.env.E2E_USE_GRAPHQL === 'true';
const apiURL = `http://localhost:${DTX_API_LOCAL_PORT}`;

// Shared Supabase env for the dtx-web dev server (cookie auth + client bearer).
const webSupabaseEnv = {
	PUBLIC_SUPABASE_URL: TEST_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' // render the blog Download button
};

// dtx-web webServer: migrate+seed (OFF leg only) then start vite dev with platformProxy.
// The flag-ON leg also boots dtx-api (seeded) via wrangler dev with test Supabase + local
// CORS. A conditional spread (rather than `.push`) keeps both entries in one array literal so
// their differing `env` shapes don't trip the array's element-type inference.
//
// NOTE: `--var KEY:VALUE` values below are concatenated unquoted into the shell command.
// The test Supabase URL + anon key are shell-safe (no spaces/metacharacters); keep them that
// way when filling real creds, or quote them.
const webServers = [
	{
		command: useGraphQL
			? 'bun run --filter=dtx-web dev'
			: 'bun run e2e/setup/prepare-stack.ts && E2E_PLATFORM_PROXY=1 bun run --filter=dtx-web dev',
		url: 'http://localhost:5173',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		env: {
			...process.env,
			VITE_E2E: 'true',
			E2E_PLATFORM_PROXY: useGraphQL ? '' : '1',
			PUBLIC_USE_GRAPHQL_API: useGraphQL ? 'true' : 'false',
			PUBLIC_DTX_API_URL: apiURL,
			PUBLIC_SIMFILE_BUCKET_URL: process.env.PUBLIC_SIMFILE_BUCKET_URL ?? baseURL,
			VITE_DTX_SERVER_URL: process.env.VITE_DTX_SERVER_URL ?? baseURL,
			...webSupabaseEnv
		}
	},
	...(useGraphQL
		? [
				{
					command:
						'bun run e2e/setup/prepare-stack.ts && ' +
						'cd packages/dtx-api && bunx wrangler dev --port ' +
						DTX_API_LOCAL_PORT +
						' --persist-to .wrangler/state' +
						` --var SUPABASE_URL:${TEST_SUPABASE_URL}` +
						` --var SUPABASE_ANON_KEY:${TEST_SUPABASE_ANON_KEY}` +
						' --var CORS_ALLOWED_ORIGINS:http://localhost:5173' +
						' --var PUBLIC_ENABLE_BLOG_DOWNLOAD:true',
					url: `${apiURL}/graphql?query=%7B__typename%7D`,
					reuseExistingServer: !process.env.CI,
					timeout: 180_000,
					env: { ...process.env, E2E_USE_GRAPHQL: 'true' }
				}
			]
		: [])
];

export default defineConfig({
	testDir: './e2e',
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
			testIgnore: [/global\.setup\.ts/, /auth-lifecycle\.spec\.ts/]
		},
		// Auth-dependent projects are included only when credentials are configured.
		// Without E2E_USER_PASSWORD + E2E_USER_ID in the environment, these are
		// omitted so CI stays green until a test Supabase project is provisioned.
		...(isAuthConfigured
			? [
					{ name: 'setup', testMatch: /global\.setup\.ts/ },
					{
						name: 'chromium-auth',
						use: { ...devices['Desktop Chrome'] },
						testMatch: /auth-lifecycle\.spec\.ts/,
						dependencies: ['setup']
					}
				]
			: [])
	],
	webServer: webServers
});
