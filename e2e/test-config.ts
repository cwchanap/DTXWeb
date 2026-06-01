// e2e/test-config.ts
//
// Credentials for the DEDICATED, THROWAWAY e2e Supabase project only.
// The anon key is public by design (it ships in client bundles).
// All other values (URL, email, password, user ID) must be set via
// environment variables (e.g. GitHub Secrets) — NEVER committed to git.
// NEVER put prod/pre-prod credentials here.
//
// Set these via environment variables (e.g. GitHub Secrets) for CI.
// When auth env vars are missing, the setup + chromium-auth projects are
// excluded so non-auth tests still pass.

export const TEST_SUPABASE_URL: string =
	process.env.E2E_SUPABASE_URL || 'https://REPLACE_ME.supabase.co';
export const TEST_SUPABASE_ANON_KEY: string =
	process.env.E2E_SUPABASE_ANON_KEY || 'REPLACE_ME_ANON_KEY'; // public by design — ships in client bundles
export const TEST_USER_EMAIL: string = process.env.E2E_USER_EMAIL || 'REPLACE_ME_EMAIL';
export const TEST_USER_PASSWORD: string = process.env.E2E_USER_PASSWORD || 'REPLACE_ME_PASSWORD';

/** Supabase auth UUID of TEST_USER_EMAIL. Read once after provisioning (runbook). */
export const TEST_USER_ID: string = process.env.E2E_USER_ID || 'REPLACE_ME_UUID';

/** Placeholder sentinel used to detect unset env vars. */
const PLACEHOLDER = (v: string) => v.includes('REPLACE_ME') || v === '';

/**
 * True only when ALL six credential env vars are set to non-placeholder values.
 * Any partial configuration would produce confusing mid-test failures (e.g. a real
 * Supabase URL but a placeholder anon key boots a half-configured client), so this
 * is all-or-nothing.
 */
export const isAuthConfigured =
	!PLACEHOLDER(TEST_SUPABASE_URL) &&
	!PLACEHOLDER(TEST_SUPABASE_ANON_KEY) &&
	!PLACEHOLDER(TEST_USER_EMAIL) &&
	!PLACEHOLDER(TEST_USER_PASSWORD) &&
	!PLACEHOLDER(TEST_USER_ID);

/** Fixed seed chart ids (see plan's test-data table). */
export const CHART_A_ID: number = 1001; // owned by test user, unpublished — lifecycle journey
export const CHART_B_ID: number = 1002; // published, has R2 file — download journey
export const CHART_A_TITLE: string = 'E2E Lifecycle Chart';
export const CHART_B_TITLE: string = 'E2E Download Chart';

/** dtx-api local port for the flag-ON leg. */
export const DTX_API_LOCAL_PORT: number = 8787;
