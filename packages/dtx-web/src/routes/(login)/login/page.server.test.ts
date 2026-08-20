import { describe, expect, it } from 'vitest';

import {
	GOOGLE_AUTH_GENERIC_MESSAGE,
	GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE,
	GOOGLE_AUTH_UNAVAILABLE_MESSAGE,
	safeAppRedirectPath,
	sanitizeGoogleAuthError
} from '$lib/auth/google';

describe('login redirect and provider error behavior', () => {
	it('keeps safe app destinations and rejects external or protocol-relative paths', () => {
		expect(safeAppRedirectPath('/app/score')).toBe('/app/score');
		expect(safeAppRedirectPath('https://evil.example')).toBe('/app/account');
		expect(safeAppRedirectPath('//evil.example/app/score')).toBe('/app/account');
	});

	it('sanitizes provider cancellation and unknown failures', () => {
		expect(sanitizeGoogleAuthError('access_denied')).toBe(GOOGLE_AUTH_GENERIC_MESSAGE);
		expect(sanitizeGoogleAuthError('provider token leaked')).toBe(GOOGLE_AUTH_GENERIC_MESSAGE);
	});

	it('keeps existing-account-only and explicit-link conflict copy', () => {
		expect(sanitizeGoogleAuthError('signup disabled')).toBe(GOOGLE_AUTH_UNAVAILABLE_MESSAGE);
		expect(sanitizeGoogleAuthError('account_already_linked_to_different_user')).toBe(
			GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE
		);
	});
});
