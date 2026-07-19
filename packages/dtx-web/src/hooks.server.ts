import { createServerClient } from '@supabase/ssr';
import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Database } from '@dtx/common';

import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { json, text } from '@sveltejs/kit';

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
		// Desktop logins redirect back to the app via deep link and ignore
		// `next`, so preserve only the `redirect` param there. For web
		// logins, thread the original path+search as `next` so the login
		// flow (password action and Google OAuth callback) can return the
		// user to the page they were trying to reach (e.g. /app/score)
		// instead of dropping them on /app. The login action re-validates
		// `next` via safeAppRedirectPath, so a crafted value can't pivot
		// outside /app*; here the value is server-derived from the actual
		// request path, so it is already a /app* path.
		if (redirectParam) {
			redirect(303, `/login?redirect=${redirectParam}`);
		} else {
			const next = `${event.url.pathname}${event.url.search}`;
			redirect(303, `/login?next=${encodeURIComponent(next)}`);
		}
	}

	// Handle authenticated access to login page - preserve any redirect parameter
	if (event.locals.session && event.url.pathname === '/login') {
		// If there's a desktop redirect parameter, preserve it. Also forward
		// desktop_callback so the /app page can still reach the desktop's
		// declared callback when the browser already had a web session —
		// otherwise the /login onMount (which stashes it in sessionStorage)
		// never runs and the app falls back to the default deep link.
		if (redirectParam === 'desktop') {
			const desktopCallback = url.searchParams.get('desktop_callback');
			const redirectUrl = desktopCallback
				? `/app?redirect=desktop&desktop_callback=${encodeURIComponent(desktopCallback)}`
				: '/app?redirect=desktop';
			redirect(303, redirectUrl);
		} else {
			redirect(303, '/app');
		}
	}

	return resolve(event);
};

export const handle: Handle = sequence(csrf, supabase, authGuard);
