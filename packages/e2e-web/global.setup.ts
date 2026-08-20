import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD, isAuthConfigured } from './test-config';

const authFile = '.auth/user.json';

if (!isAuthConfigured) {
	throw new Error(
		'Better Auth e2e setup requires E2E_USER_EMAIL and E2E_USER_PASSWORD to be configured'
	);
}

setup('authenticate test user', async ({ page }) => {
	await page.goto('/login');
	await page.waitForSelector('html[data-e2e-hydrated="true"]');

	await page.locator('#email').fill(TEST_USER_EMAIL);
	await page.locator('#password').fill(TEST_USER_PASSWORD);
	await page.getByRole('button', { name: 'Login' }).click();

	// Race navigation against a visible login-error so failures read as
	// "login failed: <error text>" instead of a generic navigation timeout.
	const loginError = page.locator('[data-error], .error, [role="alert"]').first();
	await Promise.race([
		page.waitForURL('**/app'),
		loginError.waitFor({ state: 'visible', timeout: 15_000 }).then(async () => {
			throw new Error(`Login failed: ${(await loginError.textContent()) || 'unknown error'}`);
		})
	]);
	await expect(page).toHaveURL(/\/app(\?|$)/);

	mkdirSync(dirname(authFile), { recursive: true });
	await page.context().storageState({ path: authFile });
});
