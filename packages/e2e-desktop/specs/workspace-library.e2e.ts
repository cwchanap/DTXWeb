import { join } from 'node:path';

import { browser, expect, $ } from '@wdio/globals';

import { openWorkspace } from '../support/app';
import {
	createWorkspaceFixture,
	fixtureFolderName,
	fixtureSongTitle,
	type WorkspaceFixture
} from '../support/workspace-fixture';

describe('Desktop workspace library', () => {
	let fixture: WorkspaceFixture;

	before(async () => {
		fixture = await createWorkspaceFixture();
	});

	after(async () => {
		await fixture?.cleanup();
	});

	beforeEach(async () => {
		await openWorkspace(fixture.workspaceRoot);
	});

	it('restores a workspace and filters its DTX songs', async () => {
		const songButton = await $(`//button[.//span[normalize-space()="${fixtureSongTitle}"]]`);
		await songButton.waitForDisplayed();

		const search = await $('input[placeholder="Search songs and folders..."]');
		await search.setValue('does-not-exist');
		await expect(
			$(`//div[contains(normalize-space(), 'No results found for "does-not-exist"')]`)
		).toBeDisplayed();

		await $('button[aria-label="Clear search"]').click();
		await $(`//button[.//span[normalize-space()="${fixtureSongTitle}"]]`).waitForDisplayed();
	});

	it('opens a local song in the editor with its folder mapping', async () => {
		await $(`//button[.//span[normalize-space()="${fixtureSongTitle}"]]`).click();

		const openEditor = await $('button[aria-label="Open Editor"]');
		await openEditor.waitForDisplayed();
		await openEditor.click();

		await browser.waitUntil(
			async () => (await browser.getUrl()).includes(`#editor/${fixtureFolderName}`),
			{
				timeoutMsg: 'Expected the selected local song to open in the desktop editor'
			}
		);

		const mapping = await browser.execute(() => {
			const stored = localStorage.getItem('editor_mapping_cache');
			return stored ? JSON.parse(stored) : null;
		});
		expect(mapping?.simFileIdToMetadata?.FixtureSong?.songName).toBe(fixtureSongTitle);
		expect(mapping?.simFileIdToMetadata?.FixtureSong?.folderPath).toBe(
			join(fixture.workspaceRoot, fixtureFolderName)
		);
	});
});
