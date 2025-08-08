import { describe, it, expect, vi } from 'vitest';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@dtx/common';

vi.mock('@supabase/ssr');
vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
	PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key'
}));

describe('Supabase Client', () => {
	it('should create browser client with correct configuration', async () => {
		const mockClient = { auth: { getUser: vi.fn() } };
		vi.mocked(createBrowserClient).mockReturnValue(mockClient as any);

		// Import after mocking
		const { supabase } = await import('./supabase');

		expect(createBrowserClient).toHaveBeenCalledWith<[string, string]>(
			'https://test.supabase.co',
			'test-anon-key'
		);
		expect(supabase).toBe(mockClient);
	});

	it('should export a supabase client instance', async () => {
		const { supabase } = await import('./supabase');
		expect(supabase).toBeDefined();
	});
});
