import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Database } from '@dtx/common';

import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { json, text } from '@sveltejs/kit';

// Helper function to decode JWT payload without verification
const decodeJwtPayload = (token: string): { exp?: number } | null => {
	try {
		const base64Url = token.split('.')[1];
		if (!base64Url) return null;
		let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		// Add required padding for Base64 decoding (RFC 7515)
		while (base64.length % 4 !== 0) {
			base64 += '=';
		}
		const jsonPayload = atob(base64);
		return JSON.parse(jsonPayload);
	} catch (err) {
		console.error('decodeJwtPayload: failed to parse JWT payload — rejecting token', err);
		return null;
	}
};

const isFormContentType = (request: Request): boolean => {
	const contentType = request.headers.get('content-type');
	return (
		(contentType?.includes('application/x-www-form-urlencoded') ||
			contentType?.includes('multipart/form-data')) ??
		false
	);
};

const csrf: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	const requestOrigin = request.headers.get('origin');
	const isSameOrigin = requestOrigin === url.origin;

	// Check if request is from desktop app
	const userAgent = request.headers.get('user-agent');
	const requestedWith = request.headers.get('x-requested-with');
	const isDesktopApp = userAgent?.includes('DTXDesktopApp') && requestedWith === 'DTXDesktopApp';

	const forbidden =
		isFormContentType(request) &&
		['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
		!isSameOrigin &&
		!isDesktopApp;

	if (forbidden) {
		const message = `Cross-site ${request.method} form submissions are forbidden`;
		if (request.headers.get('accept') === 'application/json') {
			return json({ message }, { status: 403 });
		}
		return text(message, { status: 403 });
	}

	return resolve(event);
};

const supabase: Handle = async ({ event, resolve }) => {
	type CookieSetOptions = Parameters<typeof event.cookies.set>[2];

	/**
	 * Creates a Supabase client specific to this server request.
	 *
	 * The Supabase client gets the Auth token from the request cookies.
	 */
	event.locals.supabase = createServerClient<Database>(
		PUBLIC_SUPABASE_URL,
		PUBLIC_SUPABASE_ANON_KEY,
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				/**
				 * SvelteKit's cookies API requires `path` to be explicitly set in
				 * the cookie options. Setting `path` to `/` replicates previous/
				 * standard behavior.
				 */
				setAll: (
					cookiesToSet: Array<{
						name: string;
						value: string;
						options: CookieSetOptions;
					}>
				) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						event.cookies.set(name, value, { ...(options ?? {}), path: '/' });
					});
				}
			}
		}
	) as unknown as typeof event.locals.supabase;

	/**
	 * Unlike `supabase.auth.getSession()`, which returns the session _without_
	 * validating the JWT, this function also calls `getUser()` to validate the
	 * JWT before returning the session.
	 */
	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) {
			return { session: null, user: null };
		}

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error) {
			// JWT validation has failed
			return { session: null, user: null };
		}

		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			/**
			 * Supabase libraries use the `content-range` and `x-supabase-api-version`
			 * headers, so we need to tell SvelteKit to pass it through.
			 */
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

export const authGuard: Handle = async ({ event, resolve }) => {
	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;

	// Check for redirect parameters in the URL
	const url = new URL(event.request.url);
	const redirectParam = url.searchParams.get('redirect');

	// Handle unauthenticated access to protected pages
	if (!event.locals.session && event.url.pathname.startsWith('/app')) {
		// Pass any redirect parameter to the login page
		const redirectUrl = redirectParam ? `/login?redirect=${redirectParam}` : '/login';
		redirect(303, redirectUrl);
	}

	// Handle authenticated access to login page - preserve any redirect parameter
	if (event.locals.session && event.url.pathname === '/login') {
		// If there's a desktop redirect parameter, preserve it
		const redirectUrl = redirectParam === 'desktop' ? '/app?redirect=desktop' : '/app';
		redirect(303, redirectUrl);
	}

	// Handle unauthenticated API access for all /api/ routes
	// Support both cookie-based auth (web app) and bearer token auth (desktop app)
	// Public routes (when no bearer token is provided):
	// - GET /api/chart?scope=published (blog page listing)
	// - GET /api/chart/[id] (route enforces published/owner checks)
	// - GET /api/simFile/listFiles/[simfileID] (route enforces published/owner checks)
	const requestMethod = event.request.method || 'GET';
	const isPublicChartListRoute =
		requestMethod === 'GET' &&
		event.url.pathname === '/api/chart' &&
		event.url.searchParams.get('scope') === 'published';
	const isPublicChartDetailRoute =
		requestMethod === 'GET' && /^\/api\/chart\/\d+$/.test(event.url.pathname);
	const isPublicListFilesRoute =
		requestMethod === 'GET' && /^\/api\/simFile\/listFiles\/\d+$/.test(event.url.pathname);
	const isPublicDownloadRoute =
		requestMethod === 'GET' && /^\/api\/simFile\/download\/\d+$/.test(event.url.pathname);
	const isPublicBulkDownloadRoute =
		requestMethod === 'POST' && event.url.pathname === '/api/simFile/download/bulk';
	const isPublicApiRoute =
		isPublicChartListRoute ||
		isPublicChartDetailRoute ||
		isPublicListFilesRoute ||
		isPublicDownloadRoute ||
		isPublicBulkDownloadRoute;

	if (!event.locals.session && event.url.pathname.startsWith('/api/')) {
		const authHeader = event.request.headers.get('Authorization');
		if (authHeader?.toLowerCase().startsWith('bearer ')) {
			const token = authHeader.slice(7);
			// Validate the bearer token using Supabase
			const { data: userData, error: userError } =
				await event.locals.supabase.auth.getUser(token);
			if (userError || !userData.user) {
				return json({ error: 'Unauthorized' }, { status: 401 });
			}
			// Set user from bearer token for route handlers
			event.locals.user = userData.user;
			// Create a synthetic session object for bearer token auth
			// This session should not be used for refresh operations
			// Decode JWT payload to get actual expiration time
			const payload = decodeJwtPayload(token);
			if (!payload) {
				return json({ error: 'Unauthorized' }, { status: 401 });
			}
			const nowSeconds = Math.floor(Date.now() / 1000);
			// Clamp expiresIn to minimum 0 to handle clock skew (negative values when payload.exp < nowSeconds)
			const expiresIn = Math.max(0, payload.exp ? payload.exp - nowSeconds : 3600);
			const expiresAt = nowSeconds + expiresIn;
			event.locals.session = {
				access_token: token,
				refresh_token: '', // No refresh token for bearer auth
				expires_in: expiresIn,
				expires_at: expiresAt,
				token_type: 'bearer',
				user: userData.user
			};
			// Create a new Supabase client configured with the bearer token
			// This ensures RLS policies work correctly for subsequent database queries
			// We use createClient instead of setSession because setSession requires a refresh token
			event.locals.supabase = createClient<Database>(
				PUBLIC_SUPABASE_URL,
				PUBLIC_SUPABASE_ANON_KEY,
				{
					auth: {
						persistSession: false,
						autoRefreshToken: false,
						detectSessionInUrl: false,
						storage: {
							getItem: (key: string) => {
								// Supabase expects a JSON stringified session object or null
								// Returning raw token causes parse errors
								if (key === 'sb-auth-token' || key.startsWith('sb-')) {
									return null;
								}
								return null;
							},
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							setItem: (_key: string, _value: string) => {
								// No-op: we don't persist bearer tokens
								// Intentionally ignores all setItem calls for this in-memory storage
							},
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							removeItem: (_key: string) => {
								// No-op: nothing to remove in this in-memory storage
							}
						}
					},
					global: {
						headers: {
							Authorization: `Bearer ${token}`
						}
					}
				}
			) as typeof event.locals.supabase;
		} else if (!isPublicApiRoute) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
	}

	return resolve(event);
};

export const handle: Handle = sequence(csrf, supabase, authGuard);
