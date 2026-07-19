import { redirect, fail } from '@sveltejs/kit';
import {
	GOOGLE_OAUTH_SCOPES,
	buildAuthCallbackUrl,
	safeAppRedirectPath,
	sanitizeGoogleAuthError
} from '$lib/auth/google';

import type { Actions } from './$types';

export const actions: Actions = {
	login: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;
		const redirectToDesktop = formData.get('redirect') === 'desktop';
		// `next` is only sent for web logins (the +page.svelte guards this),
		// but defend-in-depth: ignore it whenever desktop is set. Validate
		// via safeAppRedirectPath so a crafted value can't pivot outside
		// /app*. Empty/null falls back to /app (the pre-existing default).
		const nextRaw = redirectToDesktop ? null : (formData.get('next') as string | null);
		const nextPath = nextRaw ? safeAppRedirectPath(nextRaw) : '/app';

		const { error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			console.error('Login error:', error);
			return fail(400, {
				success: false,
				error: error.message
			});
		}

		// Login successful, redirect to app
		if (redirectToDesktop) {
			redirect(303, '/app?redirect=desktop');
		} else {
			redirect(303, nextPath);
		}
	},

	google: async ({ request, url, locals: { supabase } }) => {
		const formData = await request.formData();
		const redirectToDesktop = formData.get('redirect') === 'desktop';
		// Thread `next` into the OAuth callback URL so the callback can
		// honor it after the Google round-trip. Only for web logins; desktop
		// logins redirect back to the desktop app, not a web route. The
		// callback re-validates with safeAppRedirectPath before use.
		const nextRaw = redirectToDesktop ? null : (formData.get('next') as string | null);
		const nextPath = nextRaw ? safeAppRedirectPath(nextRaw) : null;
		const redirectTo = buildAuthCallbackUrl(
			url.origin,
			redirectToDesktop ? 'desktop' : 'web',
			nextPath
		);

		const { data, error } = await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo,
				scopes: GOOGLE_OAUTH_SCOPES,
				skipBrowserRedirect: true
			}
		});

		if (error || !data?.url) {
			console.error('Google login error:', error);
			return fail(400, {
				success: false,
				error: sanitizeGoogleAuthError(error?.message)
			});
		}

		redirect(303, data.url);
	}
};
