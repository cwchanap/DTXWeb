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
	loginNextPath: string | undefined,
	message: string,
	intent: GoogleRedirectIntent
): string =>
	accountLink
		? buildLinkedAccountRedirect(nextPath, 'error', message)
		: buildLoginErrorRedirect(message, intent, loginNextPath);

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const intent = callbackIntent(url);
	// Account-link callbacks always carry `next=/app/account` (set by
	// buildAccountCallbackUrl), so safeAppRedirectPath yields /app/account.
	// For normal logins, `next` is absent unless the login flow preserved a
	// return path (e.g. /app/score); default to /app to preserve the
	// pre-existing behavior. safeAppRedirectPath still validates any
	// present value against the /app* allow-list.
	const nextParam = url.searchParams.get('next');
	const nextPath = nextParam ? safeAppRedirectPath(nextParam) : '/app';
	const accountLink = isAccountLinkCallback(url);
	// `loginNextPath` preserves the original return path through web login
	// error retries. Only set for non-account-link web callbacks: account-
	// link identity failures that sign out the user keep the pre-existing
	// /login?error=... URL (when the session is preserved they route through
	// buildLinkedAccountRedirect, which already honors next). Desktop intent
	// is ignored by buildLoginErrorRedirect.
	const loginNextPath = nextParam && !accountLink ? nextPath : undefined;
	const providerError =
		url.searchParams.get('error_description') ?? url.searchParams.get('error');

	if (providerError) {
		const message = sanitizeGoogleAuthError(providerError);
		redirect(
			303,
			buildCallbackErrorRedirect(accountLink, nextPath, loginNextPath, message, intent)
		);
	}

	const code = url.searchParams.get('code');
	if (!code) {
		redirect(
			303,
			buildCallbackErrorRedirect(
				accountLink,
				nextPath,
				loginNextPath,
				GOOGLE_AUTH_GENERIC_MESSAGE,
				intent
			)
		);
	}

	let exchangeResult: AuthTokenResponse;
	try {
		exchangeResult = await supabase.auth.exchangeCodeForSession(code);
	} catch (error) {
		console.error('Auth callback exchange error:', error);
		redirect(
			303,
			buildCallbackErrorRedirect(
				accountLink,
				nextPath,
				loginNextPath,
				GOOGLE_AUTH_GENERIC_MESSAGE,
				intent
			)
		);
	}
	const { error } = exchangeResult;
	if (error) {
		console.error('Auth callback exchange returned error:', error);
		const message = sanitizeGoogleAuthError(error.message);
		redirect(
			303,
			buildCallbackErrorRedirect(accountLink, nextPath, loginNextPath, message, intent)
		);
	}

	let identitiesResult;
	try {
		identitiesResult = await supabase.auth.getUserIdentities();
	} catch (error) {
		console.error('Auth callback identity lookup error:', error);
		await supabase.auth.signOut();
		redirect(303, buildLoginErrorRedirect(GOOGLE_AUTH_GENERIC_MESSAGE, intent, loginNextPath));
	}
	const { data: identitiesData, error: identitiesError } = identitiesResult;
	const identities = identitiesData?.identities ?? [];
	const hasGoogleIdentity = identities.some((identity) => identity.provider === 'google');
	const hasNonGoogleIdentity = identities.some((identity) => identity.provider !== 'google');

	if (identitiesError || !hasGoogleIdentity || !hasNonGoogleIdentity) {
		console.error('Auth callback identity check failed:', identitiesError);
		// Account-link callbacks run for an already-signed-in user. Preserve
		// their existing password session only when identities lookup succeeded
		// and confirms a non-Google identity — the Google link failed but
		// they're still a verified password user. When identities lookup
		// errored or returned a Google-only session, sign out: a forged
		// `link=google` callback can produce a Google-only session, and the
		// /app guard doesn't re-check identities on subsequent requests, so
		// retaining it would grant persistent access.
		const preserveSession = accountLink && !identitiesError && hasNonGoogleIdentity;
		if (preserveSession) {
			redirect(
				303,
				buildLinkedAccountRedirect(nextPath, 'error', GOOGLE_AUTH_GENERIC_MESSAGE)
			);
		}
		await supabase.auth.signOut();
		redirect(
			303,
			buildLoginErrorRedirect(GOOGLE_AUTH_UNAVAILABLE_MESSAGE, intent, loginNextPath)
		);
	}

	if (accountLink) {
		redirect(303, buildLinkedAccountRedirect(nextPath, 'connected'));
	}

	// Desktop logins redirect to /app?redirect=desktop to trigger the
	// desktop deep-link handoff; `next` is a web-route concept and is never
	// set for desktop intent. Web logins honor the validated `nextPath`
	// (defaults to /app when no return path was preserved).
	redirect(303, intent === 'desktop' ? '/app?redirect=desktop' : nextPath);
};
