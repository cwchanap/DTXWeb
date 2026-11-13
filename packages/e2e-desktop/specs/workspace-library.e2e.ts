import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browser, expect, $ } from '@wdio/globals';

import { openWorkspace, waitForUiDisplayed } from '../support/app';
import {
	fixtureFolderName,
	fixtureSongTitle,
	getPreseededWorkspaceFixture,
	type WorkspaceFixture
} from '../support/workspace-fixture';

describe('Desktop workspace library', () => {
	let fixture: WorkspaceFixture;

	before(() => {
		fixture = getPreseededWorkspaceFixture();
	});

	beforeEach(async () => {
		await openWorkspace();
	});

	it('restores a workspace and filters its DTX songs', async () => {
		await waitForUiDisplayed('span', { text: fixtureSongTitle });

		// TEMPORARY (HPA-316 task 4): capture the workspace library UI once per
		// runner for a vision-capable reviewer; removed after inspection. An
		// empty capture throws so evidence loss is never silent.
		const evidencePath = resolve(
			dirname(fileURLToPath(import.meta.url)),
			'..',
			'visual-evidence',
			`workspace-library-${process.platform}.png`
		);
		mkdirSync(dirname(evidencePath), { recursive: true });
		const screenshot = await browser.saveScreenshot(evidencePath);
		if (!screenshot?.length) {
			throw new Error('Expected a non-empty workspace library screenshot');
		}

		const search = await $('input[placeholder="Search songs and folders..."]');
		await search.setValue('does-not-exist');
		await expect(
			$(`//div[contains(normalize-space(), 'No results found for "does-not-exist"')]`)
		).toBeDisplayed();

		await $('button[aria-label="Clear search"]').click();
		await waitForUiDisplayed('span', { text: fixtureSongTitle });
	});

	it('opens a local song in the editor with its folder mapping', async () => {
		await $(`//button[.//span[normalize-space()="${fixtureSongTitle}"]]`).click();

		await waitForUiDisplayed('button[aria-label="Open Editor"]');
		const openEditor = await $('button[aria-label="Open Editor"]');
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
