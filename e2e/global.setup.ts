import { test as setup, expect } from '@playwright/test';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from './test-config';

const authFile = 'e2e/.auth/user.json';

setup('authenticate test user', async ({ page }) => {
	await page.goto('/login');
	await page.waitForSelector('html[data-e2e-hydrated="true"]');

	await page.locator('#email').fill(TEST_USER_EMAIL);
	await page.locator('#password').fill(TEST_USER_PASSWORD);
	await page.getByRole('button', { name: 'Login' }).click();

	// Successful login redirects to /app.
	await page.waitForURL('**/app');
	await expect(page).toHaveURL(/\/app(\?|$)/);

	await page.context().storageState({ path: authFile });
});
