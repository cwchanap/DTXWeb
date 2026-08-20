export const GOOGLE_AUTH_UNAVAILABLE_MESSAGE =
	'Google sign-in is only available for existing linked accounts.';
export const GOOGLE_AUTH_GENERIC_MESSAGE = 'Google authentication failed. Please try again.';
export const GOOGLE_AUTH_LINKING_CONFIG_MESSAGE =
	'Google account linking is not enabled for this Drumery environment.';
export const GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE =
	'That Google account is already connected to another Drumery account.';

export const GOOGLE_AUTH_ERROR_MESSAGES = [
	GOOGLE_AUTH_UNAVAILABLE_MESSAGE,
	GOOGLE_AUTH_GENERIC_MESSAGE,
	GOOGLE_AUTH_LINKING_CONFIG_MESSAGE,
	GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE
] as const;

export const safeAppRedirectPath = (value: string | null | undefined): string => {
	if (!value || value.startsWith('//')) return '/app/account';
	let resolved: URL;
	try {
		resolved = new URL(value, 'http://local.invalid');
	} catch {
		return '/app/account';
	}
	if (resolved.pathname !== '/app' && !resolved.pathname.startsWith('/app/')) {
		return '/app/account';
	}
	return `${resolved.pathname}${resolved.search}`;
};

export const sanitizeGoogleAuthError = (message: string | null | undefined): string => {
	if (GOOGLE_AUTH_ERROR_MESSAGES.some((knownMessage) => knownMessage === message)) {
		return message ?? GOOGLE_AUTH_GENERIC_MESSAGE;
	}

	const lower = (message ?? '').toLowerCase();

	if (
		lower.includes('signup') ||
		lower.includes('sign up') ||
		lower.includes('user not allowed') ||
		lower.includes('user_not_allowed') ||
		lower.includes('account not linked') ||
		lower.includes('account_not_linked') ||
		lower.includes('unable_to_create_user') ||
		lower.includes('unable to create user')
	) {
		return GOOGLE_AUTH_UNAVAILABLE_MESSAGE;
	}

	if (
		lower.includes('manual_linking_disabled') ||
		lower.includes('manual linking') ||
		lower.includes('linking_not_allowed') ||
		lower.includes('account linking is not enabled')
	) {
		return GOOGLE_AUTH_LINKING_CONFIG_MESSAGE;
	}

	if (
		lower.includes('already linked') ||
		lower.includes('already_linked') ||
		lower.includes('already connected') ||
		lower.includes('identity is already linked') ||
		lower.includes('identity already linked')
	) {
		return GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE;
	}

	return GOOGLE_AUTH_GENERIC_MESSAGE;
};
