import { redirect } from '@sveltejs/kit';
import type { AuthTokenResponse } from '@supabase/supabase-js';
import {
	GOOGLE_AUTH_GENERIC_MESSAGE,
	GOOGLE_AUTH_UNAVAILABLE_MESSAGE,
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

const buildCallbackErrorRedirect = (
	accountLink: boolean,
	nextPath: string,
	message: string,
	intent: GoogleRedirectIntent
): string =>
	accountLink
		? buildLinkedAccountRedirect(nextPath, 'error', message)
		: buildLoginErrorRedirect(message, intent);

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const intent = callbackIntent(url);
	const nextPath = safeAppRedirectPath(url.searchParams.get('next'));
	const accountLink = isAccountLinkCallback(url);
	const providerError =
		url.searchParams.get('error_description') ?? url.searchParams.get('error');

	if (providerError) {
		const message = sanitizeGoogleAuthError(providerError);
		redirect(303, buildCallbackErrorRedirect(accountLink, nextPath, message, intent));
	}

	const code = url.searchParams.get('code');
	if (!code) {
		redirect(
			303,
			buildCallbackErrorRedirect(accountLink, nextPath, GOOGLE_AUTH_GENERIC_MESSAGE, intent)
		);
	}

	let exchangeResult: AuthTokenResponse;
	try {
		exchangeResult = await supabase.auth.exchangeCodeForSession(code);
	} catch (error) {
		console.error('Auth callback exchange error:', error);
		redirect(
			303,
			buildCallbackErrorRedirect(accountLink, nextPath, GOOGLE_AUTH_GENERIC_MESSAGE, intent)
		);
	}
	const { error } = exchangeResult;
	if (error) {
		console.error('Auth callback exchange returned error:', error);
		const message = sanitizeGoogleAuthError(error.message);
		redirect(303, buildCallbackErrorRedirect(accountLink, nextPath, message, intent));
	}

	let identitiesResult;
	try {
		identitiesResult = await supabase.auth.getUserIdentities();
	} catch (error) {
		console.error('Auth callback identity lookup error:', error);
		if (accountLink) {
			redirect(
				303,
				buildLinkedAccountRedirect(nextPath, 'error', GOOGLE_AUTH_GENERIC_MESSAGE)
			);
		}
		await supabase.auth.signOut();
		redirect(303, buildLoginErrorRedirect(GOOGLE_AUTH_GENERIC_MESSAGE, intent));
	}
	const { data: identitiesData, error: identitiesError } = identitiesResult;
	const identities = identitiesData?.identities ?? [];
	const hasGoogleIdentity = identities.some((identity) => identity.provider === 'google');
	const hasNonGoogleIdentity = identities.some((identity) => identity.provider !== 'google');

	if (identitiesError || !hasGoogleIdentity || !hasNonGoogleIdentity) {
		console.error('Auth callback identity check failed:', identitiesError);
		await supabase.auth.signOut();
		redirect(303, buildLoginErrorRedirect(GOOGLE_AUTH_UNAVAILABLE_MESSAGE, intent));
	}

	if (accountLink) {
		redirect(303, buildLinkedAccountRedirect(nextPath, 'connected'));
	}

	redirect(303, intent === 'desktop' ? '/app?redirect=desktop' : '/app');
};
