import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
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
		await page.getByRole('link', { name: 'Charts' }).click();
		await expect(page).toHaveURL(/\/blog$/);

		await page.goto('/');
		await page.getByRole('link', { name: 'Editor' }).click();
		await expect(page).toHaveURL(/\/editor$/);

		await page.goto('/');
		await page.getByRole('link', { name: 'Tools' }).click();
		await expect(page).toHaveURL(/\/tool$/);
	});
});
