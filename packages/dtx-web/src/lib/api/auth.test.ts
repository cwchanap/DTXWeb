import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, requestMock } = vi.hoisted(() => {
	const mockEnv = { PUBLIC_DTX_API_URL: 'https://api.test' };
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

beforeEach(() => {
	requestMock.mockReset();
});

describe('generateMagicLink', () => {
	it('GraphQL: calls GenerateMagicLink', async () => {
		requestMock.mockResolvedValue({
			generateMagicLink: { magicLinkUrl: 'https://magic', success: true }
		});
		const r = await generateMagicLink();
		expect(r).toEqual({ magicLinkUrl: 'https://magic' });
	});
});
