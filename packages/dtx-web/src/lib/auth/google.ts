export const GOOGLE_PROVIDER = 'google' as const;
export const GOOGLE_OAUTH_SCOPES = 'openid email profile';

export const GOOGLE_AUTH_UNAVAILABLE_MESSAGE =
	'Google sign-in is only available for existing linked accounts.';
export const GOOGLE_AUTH_GENERIC_MESSAGE = 'Google authentication failed. Please try again.';
export const GOOGLE_AUTH_LINKING_CONFIG_MESSAGE =
	'Google account linking is not enabled for this Drumery environment.';
export const GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE =
	'That Google account is already connected to another Drumery account.';

export type GoogleRedirectIntent = 'web' | 'desktop';

export const buildAuthCallbackUrl = (
	origin: string,
	intent: GoogleRedirectIntent = 'web'
): string => {
	const callbackUrl = new URL('/auth/callback', origin);
	if (intent === 'desktop') {
		callbackUrl.searchParams.set('redirect', 'desktop');
	}
	return callbackUrl.toString();
};

export const buildAccountCallbackUrl = (origin: string): string => {
	const callbackUrl = new URL('/auth/callback', origin);
	callbackUrl.searchParams.set('link', GOOGLE_PROVIDER);
	callbackUrl.searchParams.set('next', '/app/account');
	return callbackUrl.toString();
};

export const safeAppRedirectPath = (value: string | null | undefined): string => {
	if (!value || value.startsWith('//')) return '/app/account';
	if (value !== '/app' && !value.startsWith('/app/')) return '/app/account';
	return value;
};

export const appendSearchParam = (path: string, key: string, value: string): string => {
	const [pathname, search = ''] = path.split('?');
	const params = new URLSearchParams(search);
	params.set(key, value);
	const query = params.toString();
	return query ? `${pathname}?${query}` : pathname;
};

export const buildLoginErrorRedirect = (
	message: string,
	intent: GoogleRedirectIntent = 'web'
): string => {
	const params = new URLSearchParams();
	if (intent === 'desktop') {
		params.set('redirect', 'desktop');
	}
	params.set('error', message);
	return `/login?${params.toString()}`;
};

export const buildLinkedAccountRedirect = (
	nextPath: string,
	result: 'connected' | 'error',
	message?: string
): string => {
	const safeNext = safeAppRedirectPath(nextPath);
	if (result === 'connected') {
		return appendSearchParam(safeNext, 'linked', GOOGLE_PROVIDER);
	}
	return appendSearchParam(safeNext, 'auth_error', message || GOOGLE_AUTH_GENERIC_MESSAGE);
};

export const sanitizeGoogleAuthError = (message: string | null | undefined): string => {
	const lower = (message ?? '').toLowerCase();

	if (
		lower.includes('signup') ||
		lower.includes('sign up') ||
		lower.includes('user not allowed') ||
		lower.includes('not allowed')
	) {
		return GOOGLE_AUTH_UNAVAILABLE_MESSAGE;
	}

	if (lower.includes('manual_linking_disabled') || lower.includes('manual linking')) {
		return GOOGLE_AUTH_LINKING_CONFIG_MESSAGE;
	}

	if (
		lower.includes('already linked') ||
		lower.includes('already connected') ||
		lower.includes('identity is already linked') ||
		lower.includes('identity already linked')
	) {
		return GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE;
	}

	if (lower.includes('cancelled') || lower.includes('canceled') || lower.includes('denied')) {
		return GOOGLE_AUTH_GENERIC_MESSAGE;
	}

	return GOOGLE_AUTH_GENERIC_MESSAGE;
};
