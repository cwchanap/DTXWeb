import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockGetSupabaseClient = vi.fn(() => ({
	auth: { getSession: mockGetSession }
}));

const constructorArgs = vi.fn();
vi.mock('../auth', () => ({
	getSupabaseClient: (...args: unknown[]) => mockGetSupabaseClient(...args)
}));
vi.mock('graphql-request', () => ({
	GraphQLClient: class {
		constructor(url: string, options: Record<string, unknown>) {
			constructorArgs({ url, options });
		}
	}
}));

describe('graphql client', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await vi.resetModules();
		vi.stubEnv('VITE_DTX_API_URL', 'https://api.example.com/');
		mockGetSupabaseClient.mockReturnValue({
			auth: { getSession: mockGetSession }
		});
		mockGetSession.mockResolvedValue({
			data: { session: { access_token: 'test-token' } },
			error: null
		});
		constructorArgs.mockClear();
	});

	describe('getApiBaseUrl', () => {
		it('returns URL without trailing slash', async () => {
			const { getApiBaseUrl } = await import('./client');
			expect(getApiBaseUrl()).toBe('https://api.example.com');
		});

		it('throws when VITE_DTX_API_URL is not set', async () => {
			vi.stubEnv('VITE_DTX_API_URL', '');
			const { getApiBaseUrl } = await import('./client');
			expect(() => getApiBaseUrl()).toThrow(
				'VITE_DTX_API_URL environment variable is not set'
			);
		});
	});

	describe('getAccessToken', () => {
		it('returns access token on success', async () => {
			const { getAccessToken } = await import('./client');
			const token = await getAccessToken();
			expect(token).toBe('test-token');
		});

		it('throws when no supabase client', async () => {
			mockGetSupabaseClient.mockReturnValue(null);
			const { getAccessToken } = await import('./client');
			await expect(getAccessToken()).rejects.toThrow('User not authenticated');
		});

		it('throws when session has error', async () => {
			mockGetSession.mockResolvedValue({
				data: { session: null },
				error: new Error('session error')
			});
			const { getAccessToken } = await import('./client');
			await expect(getAccessToken()).rejects.toThrow('Failed to get valid session');
		});

		it('throws when no access_token in session', async () => {
			mockGetSession.mockResolvedValue({
				data: { session: { access_token: null } },
				error: null
			});
			const { getAccessToken } = await import('./client');
			await expect(getAccessToken()).rejects.toThrow('Failed to get valid session');
		});

		it('throws when session is null', async () => {
			mockGetSession.mockResolvedValue({
				data: { session: null },
				error: null
			});
			const { getAccessToken } = await import('./client');
			await expect(getAccessToken()).rejects.toThrow('Failed to get valid session');
		});
	});

	describe('getGraphQLClient', () => {
		it('creates GraphQLClient with correct URL and headers', async () => {
			const { getGraphQLClient } = await import('./client');
			await getGraphQLClient();

			expect(constructorArgs).toHaveBeenCalledWith({
				url: 'https://api.example.com/graphql',
				options: expect.objectContaining({
					headers: {
						Authorization: 'Bearer test-token',
						'User-Agent': 'DTXDesktopApp',
						'X-Requested-With': 'DTXDesktopApp'
					}
				})
			});
		});

		it('custom fetch passes abort signal and clears timeout', async () => {
			const { getGraphQLClient } = await import('./client');
			await getGraphQLClient();

			const { options } = constructorArgs.mock.calls[0][0] as {
				options: Record<string, unknown>;
			};
			const customFetch = options.fetch as (
				input: RequestInfo | URL,
				init?: RequestInit
			) => Promise<Response>;

			const mockFetch = vi.fn().mockResolvedValue(new Response());
			vi.stubGlobal('fetch', mockFetch);
			const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

			await customFetch('https://api.example.com/graphql', { method: 'POST' });

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.example.com/graphql',
				expect.objectContaining({ signal: expect.any(AbortSignal) })
			);
			expect(clearTimeoutSpy).toHaveBeenCalled();
		});

		it('propagates error when getAccessToken fails', async () => {
			mockGetSupabaseClient.mockReturnValue(null);
			const { getGraphQLClient } = await import('./client');
			await expect(getGraphQLClient()).rejects.toThrow('User not authenticated');
		});
	});
});
