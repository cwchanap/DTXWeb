import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_USE_GRAPHQL_API: 'true', PUBLIC_DTX_API_URL: 'https://api.test' }
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
});
