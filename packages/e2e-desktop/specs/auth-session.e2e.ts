import { $, browser, expect } from '@wdio/globals';

import { resetApp, waitForUiDisplayed } from '../support/app';

const e2eUserId = 'dtx-e2e-user';
const session = {
	sessionToken: 'renderer-e2e-session-token',
	user: {
		id: e2eUserId,
		name: 'Desktop E2E',
		email: 'desktop-e2e@drumery.invalid',
		emailVerified: true,
		image: null,
		createdAt: '',
		updatedAt: ''
	}
};

type RendererAuthStorage = {
	authSession: string | null;
	legacyValues: Array<string | null>;
};

type NativeAuthSession = {
	sessionToken: string;
	user: { id: string };
};

const readAuthStorage = async (): Promise<RendererAuthStorage> =>
	await browser.execute(() => ({
		authSession: localStorage.getItem('auth_session'),
		legacyValues: ['auth_access_token', 'auth_refresh_token', 'auth_user_data'].map((key) =>
			localStorage.getItem(key)
		)
	}));

describe('Desktop Better Auth session lifecycle', () => {
	beforeEach(async () => {
		await resetApp();
	});

	afterEach(async () => {
		const restored = await browser.tauri.execute<NativeAuthSession, []>(
			({ core }) => core.invoke('restore_e2e_auth_session') as unknown as NativeAuthSession
		);
		expect(restored.user.id).toBe(e2eUserId);
	});

	it('restores the Better Auth session shape and authenticated shell without a test-auth endpoint', async () => {
		const nativeSession = await browser.tauri.execute<NativeAuthSession | null, []>(
			({ core }) => core.invoke('get_current_session') as unknown as NativeAuthSession | null
		);
		expect(nativeSession?.user.id).toBe(e2eUserId);

		await browser.execute((storedSession) => {
			localStorage.clear();
			localStorage.setItem('auth_session', JSON.stringify(storedSession));
		}, session);
		await browser.refresh();

		await waitForUiDisplayed('button[aria-label="Logout"]', {
			timeoutMsg: 'Expected the Better Auth-shaped session to restore the desktop shell'
		});
		const storage = await readAuthStorage();
		expect(JSON.parse(storage.authSession ?? 'null')).toEqual(session);
		expect(storage.legacyValues).toEqual([null, null, null]);
	});

	it('clears the Better Auth session on logout', async () => {
		await browser.execute((storedSession) => {
			localStorage.clear();
			localStorage.setItem('auth_session', JSON.stringify(storedSession));
		}, session);
		await browser.refresh();
		await waitForUiDisplayed('button[aria-label="Logout"]');

		await $('button[aria-label="Logout"]').click();
		await waitForUiDisplayed('button[aria-label="Login to access cloud features"]', {
			timeoutMsg: 'Expected logout to return the desktop shell to its unauthenticated state'
		});
		expect(await readAuthStorage()).toEqual({
			authSession: null,
			legacyValues: [null, null, null]
		});
	});
});
