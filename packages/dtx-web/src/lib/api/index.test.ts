import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_DTX_API_URL: 'https://api.test' }
}));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({ getAccessTokenOrNull: vi.fn().mockResolvedValue(null) }));
vi.mock('./transport', () => ({
	makeBrowserClient: vi.fn(() => ({ type: 'browser', token: null }))
}));

describe('api barrel re-exports', () => {
	it('exports download functions from ./download', async () => {
		const mod = await import('./index');
		expect(mod.downloadSimfile).toBeDefined();
		expect(mod.bulkDownloadBaseUrl).toBeDefined();
		expect(mod.bulkDownloadHeaders).toBeDefined();
	});

	it('exports chart functions from ./chart', async () => {
		const mod = await import('./index');
		expect(mod.listSimfiles).toBeDefined();
		expect(mod.getSimfile).toBeDefined();
		expect(mod.updateSimfile).toBeDefined();
		expect(mod.deleteSimfile).toBeDefined();
	});

	it('exports user functions from ./user', async () => {
		const mod = await import('./index');
		expect(mod.getMe).toBeDefined();
		expect(mod.upsertUserProfile).toBeDefined();
	});

	it('exports auth functions from ./auth', async () => {
		const mod = await import('./index');
		expect(mod.generateMagicLink).toBeDefined();
	});

	it('exports client functions from ./client', async () => {
		const mod = await import('./index');
		expect(mod.getClient).toBeDefined();
	});
});
