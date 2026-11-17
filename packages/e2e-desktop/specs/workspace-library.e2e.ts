import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browser, expect, $ } from '@wdio/globals';

import { openWorkspace, waitForUiDisplayed } from '../support/app';
import { getWorkspaceRoot } from '../support/native';
import {
	driveDialog,
	nativeFolderDialogTimeoutMs,
	type NativeFolderDialogAction
} from '../support/native-folder-dialog';
import {
	fixtureFolderName,
	fixtureSongTitle,
	getPreseededWorkspaceFixture,
	type WorkspaceFixture
} from '../support/workspace-fixture';

const openNativeWorkspacePicker = async (): Promise<void> => {
	await $('button[aria-label="Workspace menu"]').click();
	await $('//button[@role="menuitem"][.//span[normalize-space()="Browse for folder…"]]').click();
};

const driveWorkspacePicker = async (
	action: NativeFolderDialogAction,
	directory: string
): Promise<void> => {
	const abort = new AbortController();
	const dialogDone = driveDialog(action, directory, abort.signal);
	void dialogDone.catch(() => undefined);
	try {
		await openNativeWorkspacePicker();
	} catch (error) {
		// The driver is already running — kill it so it can't interact with a
		// later test's dialog, and wait for the process to actually exit.
		abort.abort();
		await dialogDone.catch(() => undefined);
		throw error;
	}
	await dialogDone;
};

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

		await waitForUiDisplayed('h1');
		await expect($('h1')).toHaveText('DTX EDITOR', { containing: true });
		await expect($('#title-input')).toHaveValue(fixtureSongTitle);
		await expect(
			$('//*[contains(normalize-space(), "Could not load chart files")]')
		).not.toExist();
	});

	it('clears and reselects the fixture workspace through the real native folder picker', async function () {
		this.timeout(nativeFolderDialogTimeoutMs * 2 + 90_000);

		await $('button[aria-label="Clear workspace"]').click();
		await waitForUiDisplayed('p', {
			text: 'Select a root folder for your DTX files workspace',
			timeoutMsg: 'Expected the empty workspace state after clearing the native root'
		});
		await browser.waitUntil(async () => (await getWorkspaceRoot()) === null, {
			timeoutMsg: 'Expected the native workspace root to become null after Clear workspace'
		});

		await driveWorkspacePicker('select', fixture.workspaceRoot);

		await browser.waitUntil(async () => (await getWorkspaceRoot()) === fixture.workspaceRoot, {
			timeoutMsg: 'Expected the native workspace root to match the fixture after selection'
		});
		await waitForUiDisplayed('input[placeholder="Search songs and folders..."]');
		await waitForUiDisplayed('span', { text: fixtureSongTitle });
		await expect($('button[aria-label="Try again"]')).not.toExist();

		const screenshotPath = fileURLToPath(
			new URL('../logs/native-workspace-picker.png', import.meta.url)
		);
		mkdirSync(dirname(screenshotPath), { recursive: true });
		await browser.saveScreenshot(screenshotPath);
		expect(existsSync(screenshotPath) && statSync(screenshotPath).size > 0).toBe(true);

		await driveWorkspacePicker('cancel', fixture.workspaceRoot);

		await waitForUiDisplayed('input[placeholder="Search songs and folders..."]');
		await waitForUiDisplayed('span', { text: fixtureSongTitle });
		expect(await getWorkspaceRoot()).toBe(fixture.workspaceRoot);
		await expect($('button[aria-label="Try again"]')).not.toExist();
	});
});
