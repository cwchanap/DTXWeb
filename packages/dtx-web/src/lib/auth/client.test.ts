import { describe, expect, it, vi } from 'vitest';

// vitest 5 only applies vi.mock to dynamic imports inside tests
// (static imports bypass the hoisted factories)

const mockCreateAuthClient = vi.hoisted(() => vi.fn(() => ({ kind: 'better-auth-client' })));
const mockDeviceAuthorizationClient = vi.hoisted(() => vi.fn(() => ({ id: 'device' })));

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_DTX_API_URL: 'https://api.test' } }));
vi.mock('better-auth/svelte', () => ({ createAuthClient: mockCreateAuthClient }));
vi.mock('better-auth/client/plugins', () => ({
	deviceAuthorizationClient: mockDeviceAuthorizationClient
}));

describe('authClient', () => {
	it('uses the runtime public API, includes cookies, and enables device authorization', async () => {
		const { authClient } = await import('./client');
		expect(authClient).toEqual({ kind: 'better-auth-client' });
		expect(mockDeviceAuthorizationClient).toHaveBeenCalledOnce();
		expect(mockCreateAuthClient).toHaveBeenCalledWith({
			baseURL: 'https://api.test',
			fetchOptions: { credentials: 'include' },
			plugins: [{ id: 'device' }]
		});
	});
});
