import { redirect } from '@sveltejs/kit';
import {
	GOOGLE_AUTH_GENERIC_MESSAGE,
	buildLinkedAccountRedirect,
	buildLoginErrorRedirect,
	safeAppRedirectPath,
	sanitizeGoogleAuthError,
	type GoogleRedirectIntent
} from '$lib/auth/google';

import type { RequestHandler } from './$types';

const callbackIntent = (url: URL): GoogleRedirectIntent =>
	url.searchParams.get('redirect') === 'desktop' ? 'desktop' : 'web';

const isAccountLinkCallback = (url: URL): boolean => url.searchParams.get('link') === 'google';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const intent = callbackIntent(url);
	const nextPath = safeAppRedirectPath(url.searchParams.get('next'));
	const accountLink = isAccountLinkCallback(url);
	const providerError =
		url.searchParams.get('error_description') ?? url.searchParams.get('error');

	if (providerError) {
		const message = sanitizeGoogleAuthError(providerError);
		redirect(
			303,
			accountLink
				? buildLinkedAccountRedirect(nextPath, 'error', message)
				: buildLoginErrorRedirect(message, intent)
		);
	}

	const code = url.searchParams.get('code');
	if (!code) {
		redirect(
			303,
			accountLink
				? buildLinkedAccountRedirect(nextPath, 'error', GOOGLE_AUTH_GENERIC_MESSAGE)
				: buildLoginErrorRedirect(GOOGLE_AUTH_GENERIC_MESSAGE, intent)
		);
	}

	const { error } = await supabase.auth.exchangeCodeForSession(code);
	if (error) {
		const message = sanitizeGoogleAuthError(error.message);
		redirect(
			303,
			accountLink
				? buildLinkedAccountRedirect(nextPath, 'error', message)
				: buildLoginErrorRedirect(message, intent)
		);
	}

	if (accountLink) {
		redirect(303, buildLinkedAccountRedirect(nextPath, 'connected'));
	}

	redirect(303, intent === 'desktop' ? '/app?redirect=desktop' : '/app');
};
