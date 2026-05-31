// e2e/test-config.ts
//
// Credentials for the DEDICATED, THROWAWAY e2e Supabase project only.
// Safe to commit: the anon key is public by design (it ships in client bundles),
// and the test user guards an isolated project with no real data.
// NEVER put prod/pre-prod credentials here.
//
// Set these via environment variables (e.g. GitHub Secrets) for CI.
// When auth env vars are missing, the setup + chromium-auth projects are
// excluded so non-auth tests still pass.

export const TEST_SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'https://REPLACE-ME.supabase.co';
export const TEST_SUPABASE_ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? 'REPLACE_ME_ANON_KEY'; // public by design
export const TEST_USER_EMAIL = process.env.E2E_USER_EMAIL ?? 'e2e@drumery.test';
export const TEST_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? 'REPLACE_ME_PASSWORD';

/** Supabase auth UUID of TEST_USER_EMAIL. Read once after provisioning (runbook). */
export const TEST_USER_ID = process.env.E2E_USER_ID ?? 'REPLACE_ME_UUID';

/** True when the resolved credentials are non-placeholder values (env vars or committed defaults). */
export const isAuthConfigured =
	TEST_USER_PASSWORD !== 'REPLACE_ME_PASSWORD' &&
	TEST_USER_PASSWORD !== '' &&
	TEST_USER_ID !== 'REPLACE_ME_UUID' &&
	TEST_USER_ID !== '';

/** Fixed seed chart ids (see plan's test-data table). */
export const CHART_A_ID = 1001; // owned by test user, unpublished — lifecycle journey
export const CHART_B_ID = 1002; // published, has R2 file — download journey
export const CHART_A_TITLE = 'E2E Lifecycle Chart';
export const CHART_B_TITLE = 'E2E Download Chart';

/** dtx-api local port for the flag-ON leg. */
export const DTX_API_LOCAL_PORT = 8787;
