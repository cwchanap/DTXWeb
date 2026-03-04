import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@dtx/common';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({
		auth: {
			getUser: vi.fn(),
			getSession: vi.fn()
		}
	}))
}));

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:5173',
	PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key'
}));

let authGuard: typeof import('./hooks.server').authGuard;

beforeAll(async () => {
	({ authGuard } = await import('./hooks.server'));
});

const createTestJwt = (payload: Record<string, unknown>): string => {
	const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${header}.${body}.signature`;
};

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

		// Use a valid JWT-format token so decodeJwtPayload succeeds
		const testToken = createTestJwt({ sub: 'test-user', exp: 9999999999 });

		const event = createMockEvent('http://localhost:5173/api/simFile/upload', {
			Authorization: `Bearer ${testToken}`
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
		expect(mockGetUser).toHaveBeenCalledWith(testToken);

		// Verify locals.user and locals.session are set
		expect(event.locals.user).toBeTruthy();
		expect(event.locals.session).toBeTruthy();
		expect(event.locals.session?.access_token).toBe(testToken);

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
