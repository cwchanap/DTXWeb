import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authGuard } from './hooks.server';
import type { Database } from '@dtx/common';

// Helper function to create a mock event
function createMockEvent(url: string, headers?: HeadersInit) {
	return {
		request: {
			url,
			headers: new Headers(headers)
		} as Request,
		url: new URL(url, 'http://localhost:5173'),
		cookies: {
			get: vi.fn(),
			getAll: vi.fn(() => []),
			set: vi.fn(),
			delete: vi.fn(),
			serialize: vi.fn()
		},
		locals: {} as App.Locals,
		isSubRequest: false,
		platform: {},
		params: {},
		route: { id: null }
	} as any;
}

describe('hooks.server.ts - Bearer token authentication', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates a new Supabase client when valid bearer token is provided for /api/simFile routes', async () => {
		const mockGetUser = vi.fn().mockResolvedValue({
			data: { user: { id: 'test-user-id', email: 'test@example.com' } },
			error: null
		});
		const mockGetSession = vi.fn().mockResolvedValue({
			data: { session: null }
		});

		const event = createMockEvent('http://localhost:5173/api/simFile/upload', {
			Authorization: 'Bearer test-token'
		});

		// Mock the initial Supabase client
		const initialSupabaseClient = {
			auth: {
				getSession: mockGetSession,
				getUser: mockGetUser
			}
		} as unknown as SupabaseClient;

		event.locals.supabase = initialSupabaseClient;

		// Mock safeGetSession
		event.locals.safeGetSession = async () => {
			const result = await event.locals.supabase.auth.getSession();
			if (!result.data.session) {
				return { session: null, user: null };
			}
			return { session: result.data.session, user: result.data.session.user };
		};

		// Create a mock resolve function
		const resolve = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));

		// Run authGuard handle
		await authGuard({ event, resolve });

		// Verify getUser was called with the bearer token on the initial client
		expect(mockGetUser).toHaveBeenCalledWith('test-token');

		// Verify locals.user and locals.session are set
		expect(event.locals.user).toBeTruthy();
		expect(event.locals.session).toBeTruthy();
		expect(event.locals.session?.access_token).toBe('test-token');

		// Verify that a new Supabase client was created for locals.supabase
		expect(event.locals.supabase).not.toBe(initialSupabaseClient);
	});

	it('returns 401 when bearer token is invalid', async () => {
		const mockGetUser = vi.fn().mockResolvedValue({
			data: { user: null },
			error: { message: 'Invalid token' }
		});
		const mockGetSession = vi.fn().mockResolvedValue({
			data: { session: null }
		});

		const event = createMockEvent('http://localhost:5173/api/simFile/upload', {
			Authorization: 'Bearer invalid-token'
		});

		event.locals.supabase = {
			auth: {
				getSession: mockGetSession,
				getUser: mockGetUser
			}
		} as unknown as SupabaseClient;

		event.locals.safeGetSession = async () => {
			const result = await event.locals.supabase.auth.getSession();
			if (!result.data.session) {
				return { session: null, user: null };
			}
			return { session: result.data.session, user: result.data.session.user };
		};

		const resolve = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));

		// Run authGuard handle
		const result = await authGuard({ event, resolve });

		// Verify getUser was called with the bearer token
		expect(mockGetUser).toHaveBeenCalledWith('invalid-token');

		// Verify the response is a 401 error
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);

		// Verify locals.user and locals.session are still null
		expect(event.locals.user).toBeNull();
		expect(event.locals.session).toBeNull();
	});

	it('returns 401 when no bearer token or session is provided for /api/simFile routes', async () => {
		const mockGetUser = vi.fn();
		const mockGetSession = vi.fn().mockResolvedValue({
			data: { session: null }
		});

		const event = createMockEvent('http://localhost:5173/api/simFile/upload', {});

		event.locals.supabase = {
			auth: {
				getSession: mockGetSession,
				getUser: mockGetUser
			}
		} as unknown as SupabaseClient;

		event.locals.safeGetSession = async () => {
			const result = await event.locals.supabase.auth.getSession();
			if (!result.data.session) {
				return { session: null, user: null };
			}
			return { session: result.data.session, user: result.data.session.user };
		};

		const resolve = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));

		// Run authGuard handle
		const result = await authGuard({ event, resolve });

		// Verify getUser was NOT called (no token provided)
		expect(mockGetUser).not.toHaveBeenCalled();

		// Verify the response is a 401 error
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});
});
