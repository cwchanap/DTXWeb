import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, requestMock } = vi.hoisted(() => {
	const mockEnv = { PUBLIC_USE_GRAPHQL_API: 'false', PUBLIC_DTX_API_URL: 'https://api.test' };
	const requestMock = vi.fn();
	return { mockEnv, requestMock };
});

vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token'),
	getAccessToken: vi.fn().mockResolvedValue('test-token')
}));
vi.mock('./transport', () => ({
	makeBrowserClient: () => ({ request: requestMock, url: 'x', requestConfig: { headers: {} } }),
	makeServiceBindingClient: () => ({ request: requestMock })
}));

import { generateMagicLink } from './auth';

const restFetch = vi.fn();
beforeEach(() => {
	mockEnv.PUBLIC_USE_GRAPHQL_API = 'false';
	requestMock.mockReset();
	restFetch.mockReset();
	(globalThis as { fetch?: typeof fetch }).fetch = restFetch as unknown as typeof fetch;
});

describe('generateMagicLink', () => {
	it('REST: POST /api/auth/generate-magic-link', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ magicLinkUrl: 'https://magic', success: true }))
		);
		const r = await generateMagicLink();
		expect(restFetch).toHaveBeenCalledWith(
			'/api/auth/generate-magic-link',
			expect.objectContaining({ method: 'POST' })
		);
		expect(r).toEqual({ magicLinkUrl: 'https://magic', success: true });
	});

	it('GraphQL: calls GenerateMagicLink', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({
			generateMagicLink: { magicLinkUrl: 'https://magic', success: true }
		});
		const r = await generateMagicLink();
		expect(r).toEqual({ magicLinkUrl: 'https://magic', success: true });
	});
});
