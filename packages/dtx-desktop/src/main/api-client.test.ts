import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockGetSupabaseClient = vi.fn();

vi.mock('./auth', () => ({
	getSupabaseClient: mockGetSupabaseClient
}));

// Helper to import with fresh module state
const importApiClient = () => import('./api-client');

describe('api-client', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();

		// Default: authenticated client with valid session
		mockGetSupabaseClient.mockReturnValue({
			auth: {
				getSession: mockGetSession
			}
		});
		mockGetSession.mockResolvedValue({
			data: { session: { access_token: 'test-token' } },
			error: null
		});
	});

	describe('apiGet', () => {
		it('returns success with data on 200 response', async () => {
			const { apiGet } = await importApiClient();
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					json: async () => ({ id: 1 })
				})
			);
			const result = await apiGet('/api/chart');
			expect(result).toEqual({ success: true, data: { id: 1 } });
		});

		it('returns error when response is not ok', async () => {
			const { apiGet } = await importApiClient();
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					status: 404,
					statusText: 'Not Found',
					json: async () => ({ error: 'Chart not found' })
				})
			);
			const result = await apiGet('/api/chart/999');
			expect(result).toEqual({ success: false, error: 'Chart not found' });
		});

		it('falls back to HTTP status when error response has no error field', async () => {
			const { apiGet } = await importApiClient();
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					status: 500,
					statusText: 'Internal Server Error',
					json: async () => ({})
				})
			);
			const result = await apiGet('/api/chart');
			expect(result).toEqual({ success: false, error: 'HTTP 500' });
		});

		it('returns error when fetch throws', async () => {
			const { apiGet } = await importApiClient();
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
			const result = await apiGet('/api/chart');
			expect(result).toEqual({ success: false, error: 'Network error' });
		});

		it('returns error when supabase client is null', async () => {
			mockGetSupabaseClient.mockReturnValue(null);
			const { apiGet } = await importApiClient();
			const result = await apiGet('/api/chart');
			expect(result).toEqual({ success: false, error: 'User not authenticated' });
		});

		it('returns error when session fetch fails', async () => {
			mockGetSession.mockResolvedValue({
				data: { session: null },
				error: new Error('Session error')
			});
			const { apiGet } = await importApiClient();
			const result = await apiGet('/api/chart');
			expect(result).toEqual({ success: false, error: 'Failed to get valid session' });
		});

		it('includes auth headers and user agent', async () => {
			const { apiGet } = await importApiClient();
			const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
			vi.stubGlobal('fetch', mockFetch);
			await apiGet('/api/chart');
			const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
			const headers = init.headers as Record<string, string>;
			expect(headers['Authorization']).toBe('Bearer test-token');
			expect(headers['User-Agent']).toBe('DTXDesktopApp');
			expect(headers['X-Requested-With']).toBe('DTXDesktopApp');
		});
	});

	describe('apiPost', () => {
		it('returns success with data on 200 response', async () => {
			const { apiPost } = await importApiClient();
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 2 }) })
			);
			const result = await apiPost('/api/chart', { title: 'New Song' });
			expect(result).toEqual({ success: true, data: { id: 2 } });
		});

		it('sends JSON body with POST method', async () => {
			const { apiPost } = await importApiClient();
			const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
			vi.stubGlobal('fetch', mockFetch);
			await apiPost('/api/chart', { title: 'Test' });
			const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
			expect(init.method).toBe('POST');
			expect(init.body).toBe(JSON.stringify({ title: 'Test' }));
		});

		it('returns error on non-ok response', async () => {
			const { apiPost } = await importApiClient();
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					status: 400,
					statusText: 'Bad Request',
					json: async () => ({ error: 'Invalid data' })
				})
			);
			const result = await apiPost('/api/chart', {});
			expect(result).toEqual({ success: false, error: 'Invalid data' });
		});

		it('returns error when fetch throws', async () => {
			const { apiPost } = await importApiClient();
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
			const result = await apiPost('/api/chart', {});
			expect(result).toEqual({ success: false, error: 'Timeout' });
		});
	});

	describe('apiPatch', () => {
		it('returns success with data on 200 response', async () => {
			const { apiPatch } = await importApiClient();
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					json: async () => ({ id: 1, title: 'Updated' })
				})
			);
			const result = await apiPatch('/api/chart/1', { title: 'Updated' });
			expect(result).toEqual({ success: true, data: { id: 1, title: 'Updated' } });
		});

		it('sends JSON body with PATCH method', async () => {
			const { apiPatch } = await importApiClient();
			const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
			vi.stubGlobal('fetch', mockFetch);
			await apiPatch('/api/chart/1', { title: 'Test' });
			const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
			expect(init.method).toBe('PATCH');
			expect(init.body).toBe(JSON.stringify({ title: 'Test' }));
		});

		it('returns error on non-ok response', async () => {
			const { apiPatch } = await importApiClient();
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					status: 403,
					statusText: 'Forbidden',
					json: async () => ({ error: 'Forbidden' })
				})
			);
			const result = await apiPatch('/api/chart/1', {});
			expect(result).toEqual({ success: false, error: 'Forbidden' });
		});

		it('returns error when fetch throws', async () => {
			const { apiPatch } = await importApiClient();
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));
			const result = await apiPatch('/api/chart/1', {});
			expect(result).toEqual({ success: false, error: 'Connection refused' });
		});
	});
});
