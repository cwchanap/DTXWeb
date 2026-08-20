// packages/e2e-web/test-config.ts
//
// Credentials for the local Better Auth e2e user only.
// Never put production or pre-production credentials here.
//
// Set these via environment variables (e.g. GitHub Secrets) for CI.
// When auth env vars are missing, the setup + chromium-auth projects are
// excluded so non-auth tests still pass.

export const TEST_USER_EMAIL: string = process.env.E2E_USER_EMAIL || 'REPLACE_ME_EMAIL';
export const TEST_USER_PASSWORD: string = process.env.E2E_USER_PASSWORD || 'REPLACE_ME_PASSWORD';

/** Fixed Better Auth UUID shared by the local auth and application seed rows. */
export const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Placeholder sentinel used to detect unset env vars. */
const PLACEHOLDER = (v: string) => v.includes('REPLACE_ME') || v === '';

/**
 * True only when both credential env vars are set to non-placeholder values.
 * Partial configuration would produce confusing mid-test failures, so this is
 * all-or-nothing.
 */
export const isAuthConfigured = !PLACEHOLDER(TEST_USER_EMAIL) && !PLACEHOLDER(TEST_USER_PASSWORD);

/** Fixed seed chart ids (see plan's test-data table). */
export const CHART_A_ID: number = 1001; // owned by test user, unpublished — lifecycle journey
export const CHART_B_ID: number = 1002; // published, has R2 file — download journey
export const CHART_C_ID: number = 1003; // owned by test user, unpublished — auth download proof
export const CHART_A_TITLE: string = 'E2E Lifecycle Chart';
export const CHART_B_TITLE: string = 'E2E Download Chart';

/** dtx-api local port for the flag-ON leg. */
export const DTX_API_LOCAL_PORT: number = 8787;
