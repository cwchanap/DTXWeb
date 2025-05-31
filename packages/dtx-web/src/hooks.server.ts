import { createServerClient } from '@supabase/ssr';
import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Database } from '@dtx/common';

import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { json } from '@sveltejs/kit';

const supabase: Handle = async ({ event, resolve }) => {
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
				setAll: (cookiesToSet) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						event.cookies.set(name, value, { ...options, path: '/' });
					});
				}
			}
		}
	);

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

const authGuard: Handle = async ({ event, resolve }) => {
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

	// Handle unauthenticated API access
	if (!event.locals.session && event.url.pathname.startsWith('/api/simFile')) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	return resolve(event);
};

export const handle: Handle = sequence(supabase, authGuard);
