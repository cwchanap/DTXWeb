import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
	});

	test('shows the hero content', async ({ page }) => {
		await expect(page.getByRole('heading', { name: 'Feel the Beat' })).toBeVisible();
		await expect(
			page.getByText(
				'Experience the ultimate rhythm gaming platform for DTX drum simulation files.'
			)
		).toBeVisible();
	});

	test('navigates to core sections from hero actions', async ({ page }) => {
		await page.getByRole('button', { name: /Explore Charts/i }).click();
		await expect(page).toHaveURL(/\/blog$/);

		await page.goto('/');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		await page.getByRole('button', { name: /Chart Editor/i }).click();
		await expect(page).toHaveURL(/\/editor$/);

		await page.goto('/');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		await page.getByRole('button', { name: /DTX Tools/i }).click();
		await expect(page).toHaveURL(/\/tool$/);
	});
});
