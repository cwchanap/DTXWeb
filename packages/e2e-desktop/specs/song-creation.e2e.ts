import { join } from 'node:path';

import { expect, $ } from '@wdio/globals';

import { openWorkspace } from '../support/app';
import { pathExists, readFile } from '../support/native';
import { createWorkspaceFixture, type WorkspaceFixture } from '../support/workspace-fixture';

const createdSongName = 'E2E Created Song';

describe('Desktop song creation', () => {
	let fixture: WorkspaceFixture;

	before(async () => {
		fixture = await createWorkspaceFixture({ includeSong: false });
	});

	after(async () => {
		await fixture?.cleanup();
	});

	beforeEach(async () => {
		await openWorkspace(fixture.workspaceRoot);
	});

	it('creates a song and persists its generated SET.def through Rust', async () => {
		await $('button[aria-label="Create new song"]').click();

		const songName = await $('#songName');
		await songName.waitForDisplayed();
		await songName.setValue(createdSongName);

		const createSong = await $('button[type="submit"]');
		await createSong.waitForEnabled();
		await createSong.click();

		await expect($('h2=Library')).toBeDisplayed();
		expect(await pathExists(fixture.workspaceRoot, createdSongName)).toEqual({
			exists: true,
			error: null
		});

		const setDef = await readFile(
			join(fixture.workspaceRoot, createdSongName, 'SET.def'),
			fixture.workspaceRoot
		);
		expect(setDef.kind).toBe('text');
		expect(setDef.error).toBeNull();
		expect(setDef.content).toContain(`#TITLE ${createdSongName}`);
		expect(setDef.content).toContain('#L1FILE bas.dtx');
	});

	it('blocks creation when the target folder already exists', async () => {
		await $('button[aria-label="Create new song"]').click();
		await $('#songName').setValue(createdSongName);

		const warning = await $(
			`//div[contains(normalize-space(), 'A folder named "${createdSongName}" already exists')]`
		);
		await warning.waitForDisplayed();
		await expect($('button[type="submit"]')).toBeDisabled();
	});
});
