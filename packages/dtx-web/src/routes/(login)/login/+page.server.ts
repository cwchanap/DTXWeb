import { redirect, fail } from '@sveltejs/kit';
import {
	GOOGLE_OAUTH_SCOPES,
	buildAuthCallbackUrl,
	sanitizeGoogleAuthError
} from '$lib/auth/google';

import type { Actions } from './$types';

export const actions: Actions = {
	login: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;
		const redirectToDesktop = formData.get('redirect') === 'desktop';

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
			redirect(303, '/app');
		}
	},

	google: async ({ request, url, locals: { supabase } }) => {
		const formData = await request.formData();
		const redirectToDesktop = formData.get('redirect') === 'desktop';
		const redirectTo = buildAuthCallbackUrl(url.origin, redirectToDesktop ? 'desktop' : 'web');

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
