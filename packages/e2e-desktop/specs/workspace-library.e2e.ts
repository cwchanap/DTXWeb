import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browser, expect, $ } from '@wdio/globals';

import { openWorkspace, waitForUiDisplayed } from '../support/app';
import { getWorkspaceRoot } from '../support/native';
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

	it('TEMPORARY macOS AX location diagnostic (not native acceptance)', async function () {
		this.timeout(360_000);
		if (process.platform !== 'darwin') this.skip();

		console.log('TEMPORARY AX DIAGNOSTIC: gathering evidence, not native acceptance');
		const dataDir = process.env.DTX_E2E_DATA_DIR;
		if (
			process.env.GITHUB_ACTIONS !== 'true' ||
			process.env.RUNNER_OS !== 'macOS' ||
			!dataDir ||
			!basename(dataDir).startsWith('dtx-e2e-data-') ||
			dirname(fixture.workspaceRoot) !== realpathSync.native(dataDir) ||
			basename(fixture.workspaceRoot) !== 'workspace'
		) {
			throw new Error('TEMPORARY AX DIAGNOSTIC requires the hosted isolated fixture');
		}

		const diagnosticParent = mkdtempSync(
			join(dirname(fixture.workspaceRoot), 'ax-diagnostic-')
		);
		const decoy = join(diagnosticParent, 'workspace');
		mkdirSync(decoy);
		const canonicalDecoy = realpathSync.native(decoy);
		const script = fileURLToPath(
			new URL('../scripts/temporary-macos-ax-diagnostic.applescript', import.meta.url)
		);
		let safeToRemove = true;

		try {
			console.log(`TEMPORARY AX DIAGNOSTIC canonical workspace: ${fixture.workspaceRoot}`);
			console.log(`TEMPORARY AX DIAGNOSTIC canonical decoy: ${canonicalDecoy}`);
			expect(await getWorkspaceRoot()).toBe(fixture.workspaceRoot);
			await $('button[aria-label*="Workspace menu" i]').click();
			const browse = await $(
				'//*[@role="menuitem"][contains(normalize-space(.), "Browse for folder")]'
			);
			await browse.waitForDisplayed();

			let signalReady: () => void = () => {};
			const ready = new Promise<void>((resolve) => {
				signalReady = resolve;
			});
			const child = execFile(
				'osascript',
				[script, 'capture', fixture.workspaceRoot, canonicalDecoy],
				{ timeout: 140_000, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' }
			);
			const result = new Promise<Error | null>((resolve) => {
				child.on('error', (error) => resolve(error));
				child.on('close', (code, signal) => {
					resolve(
						code === 0 ? null : new Error(`controller exit=${code} signal=${signal}`)
					);
				});
			});
			let recentOutput = '';
			const print = (chunk: Buffer): void => {
				const text = chunk.toString();
				console.log(`TEMPORARY AX DIAGNOSTIC OUTPUT: ${text}`);
				recentOutput = (recentOutput + text).slice(-256);
				if (recentOutput.includes('AX_DIAGNOSTIC_READY')) signalReady();
			};
			child.stdout?.on('data', print);
			child.stderr?.on('data', print);

			const didStart = await Promise.race([
				ready.then(() => true),
				result.then(() => false),
				new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000))
			]);
			if (!didStart) {
				child.kill('SIGKILL');
				await result;
				throw new Error('TEMPORARY AX DIAGNOSTIC controller did not become ready');
			}

			safeToRemove = false;
			const click = Promise.resolve()
				.then(() => browse.click())
				.then(
					() => null,
					(error: unknown) => error
				);
			const controllerError = await result;
			const clickResult = await Promise.race([
				click,
				new Promise<Error>((resolve) =>
					setTimeout(() => resolve(new Error('Browse click did not settle')), 20_000)
				)
			]);
			const cleanupError = await new Promise<Error | null>((resolve) => {
				execFile(
					'osascript',
					[script, 'cleanup'],
					{ timeout: 15_000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' },
					(error, stdout, stderr) => {
						console.log(`TEMPORARY AX DIAGNOSTIC CLEANUP: ${stdout}\n${stderr}`);
						resolve(error);
					}
				);
			});
			safeToRemove = cleanupError === null;
			if (!cleanupError && !clickResult) {
				await waitForUiDisplayed('input[placeholder="Search songs and folders..."]');
				expect(await getWorkspaceRoot()).toBe(fixture.workspaceRoot);
				console.log('TEMPORARY AX DIAGNOSTIC: dialog cancelled; fixture root preserved');
			}
			if (controllerError || cleanupError || clickResult) {
				throw new Error(
					`TEMPORARY AX DIAGNOSTIC failed: controller=${controllerError?.message ?? 'ok'}, cleanup=${cleanupError?.message ?? 'ok'}, click=${String(clickResult)}`
				);
			}

			throw new Error('TEMPORARY AX DIAGNOSTIC deliberate failure to upload runner.log');
		} finally {
			if (safeToRemove) rmSync(diagnosticParent, { recursive: true, force: true });
		}
	});
});
