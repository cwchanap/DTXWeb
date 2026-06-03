import { test, expect } from '@playwright/test';
import { CHART_A_ID, CHART_A_TITLE } from './test-config';

test.use({ storageState: 'e2e/.auth/user.json' });

test.describe('authenticated chart lifecycle (dual-path)', () => {
	// This test DELETES chart A as its terminal action. The seed runs once per leg (not
	// per test), so a Playwright retry would find chart A already gone. Disable retries
	// to avoid retry-only failures.
	test.describe.configure({ retries: 0 });
	//
	// NOTE: the Actions menu uses Skeleton's <Popover>, which renders its content in a body
	// portal and only while open. Both seeded charts (1001 + 1002) are owned by the test user,
	// so /app/chart shows two cards — but only the OPEN card's menu items exist in the DOM.
	// That is why the Edit/Delete menu items are selected page-level (NOT scoped to the card):
	// scoping to the card would miss the portaled content, and page-level still matches exactly
	// one element because closed popovers render nothing.

	test('list → open detail → edit/save → delete', async ({ page }) => {
		// listSimfiles(MINE)
		await page.goto('/app/chart');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		// ChartList.svelte:484-510 — card view renders each chart in a ChartListItem; the
		// ChartListItem root element (ChartListItem.svelte:58) has class "music-card".
		// The filter bar also uses "music-card" (ChartList.svelte:241) but lacks the chart
		// title text, so hasText scopes correctly to the chart card.
		const card = page.locator('.music-card', { hasText: CHART_A_TITLE });
		await expect(card).toBeVisible();

		// getSimfile — open the detail page via the card Actions → Edit menu item.
		// ChartListItem.svelte:88-96: Popover triggerAriaLabel="Actions" (EllipsisVertical icon)
		await card.getByRole('button', { name: 'Actions' }).click();
		// ChartListItem.svelte:131-150: <a href="/app/chart/${item.id}" role="menuitem">Edit</a>
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		await expect(page).toHaveURL(new RegExp(`/app/chart/${CHART_A_ID}$`));
		// ChartDetail.svelte:96: <h1 ...>{simfile?.title}</h1>
		await expect(page.getByRole('heading', { level: 1, name: CHART_A_TITLE })).toBeVisible();

		// updateSimfile — fill the download link field and save.
		// ChartDetail.svelte:200-206: <input id="download_link" ...>
		await page.locator('#download_link').fill('https://example.com/e2e-edit');
		// ChartDetail.svelte:235-247: <button ...>{saveButtonText}</button>
		// saveButtonText defaults to 'Update' (ChartDetail.svelte:44).
		await page.getByRole('button', { name: 'Update' }).click();
		// routes/(app)/app/chart/[id]/+page.svelte:64-67:
		// toastStore.success({ title: 'Simfile updated successfully', ... })
		await expect(page.getByText('Simfile updated successfully')).toBeVisible();

		// deleteSimfile — back to the list, delete chart A via Actions → Delete → confirm.
		await page.goto('/app/chart');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		const cardAgain = page.locator('.music-card', { hasText: CHART_A_TITLE });
		// ChartListItem.svelte:88-96: Popover triggerAriaLabel="Actions"
		await cardAgain.getByRole('button', { name: 'Actions' }).click();
		// ChartListItem.svelte:185-209: <Button variant="menuItem" ...>Delete</Button>
		// variant="menuItem" renders as a plain <button>; text is "Delete".
		await page.getByRole('button', { name: 'Delete' }).click();
		// ChartListItem.svelte:323-364 + Modal.svelte:73-83:
		// <div role="dialog" aria-modal="true" ...> wraps the confirmation UI.
		const dialog = page.getByRole('dialog');
		// Modal.svelte:119-125: <button type="button">{confirmText}</button>
		// ChartListItem.svelte:328: confirmText="Delete"
		await dialog.getByRole('button', { name: 'Delete' }).first().click();

		// ChartList.svelte:162-165: toastStore.success({ title: 'Chart deleted', ... })
		await expect(page.getByText('Chart deleted')).toBeVisible();
		await expect(page.locator('.music-card', { hasText: CHART_A_TITLE })).toHaveCount(0);
	});
});
