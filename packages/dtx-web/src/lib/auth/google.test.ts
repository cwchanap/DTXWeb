import { describe, expect, it } from 'vitest';
import {
	GOOGLE_AUTH_GENERIC_MESSAGE,
	GOOGLE_AUTH_LINKING_CONFIG_MESSAGE,
	GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE,
	GOOGLE_AUTH_UNAVAILABLE_MESSAGE,
	safeAppRedirectPath,
	sanitizeGoogleAuthError
} from './google';

describe('google auth helpers', () => {
	it('rejects open redirects outside the app', () => {
		expect(safeAppRedirectPath('https://evil.example')).toBe('/app/account');
		expect(safeAppRedirectPath('//evil.example')).toBe('/app/account');
		expect(safeAppRedirectPath('//evil.example/app/score')).toBe('/app/account');
		expect(safeAppRedirectPath('/login')).toBe('/app/account');
		expect(safeAppRedirectPath('/application')).toBe('/app/account');
		expect(safeAppRedirectPath('/app.evil')).toBe('/app/account');
		expect(safeAppRedirectPath('/app/chart')).toBe('/app/chart');
	});

	it('normalizes ../ traversal that would escape the /app prefix', () => {
		expect(safeAppRedirectPath('/app/../etc')).toBe('/app/account');
		expect(safeAppRedirectPath('/app/account/../../etc')).toBe('/app/account');
		expect(safeAppRedirectPath('/app/foo/../chart')).toBe('/app/chart');
	});

	it('preserves query strings on safe /app paths', () => {
		expect(safeAppRedirectPath('/app/account?tab=security')).toBe('/app/account?tab=security');
		expect(safeAppRedirectPath('/app?tab=overview')).toBe('/app?tab=overview');
	});

	it('sanitizes Better Auth signup-disabled errors for existing-account-only login', () => {
		expect(sanitizeGoogleAuthError('Signups not allowed for this instance')).toBe(
			GOOGLE_AUTH_UNAVAILABLE_MESSAGE
		);
		expect(sanitizeGoogleAuthError('signup disabled')).toBe(GOOGLE_AUTH_UNAVAILABLE_MESSAGE);
		expect(sanitizeGoogleAuthError('account not linked')).toBe(GOOGLE_AUTH_UNAVAILABLE_MESSAGE);
		expect(sanitizeGoogleAuthError('account_not_linked')).toBe(GOOGLE_AUTH_UNAVAILABLE_MESSAGE);
		expect(sanitizeGoogleAuthError('unable_to_create_user')).toBe(
			GOOGLE_AUTH_UNAVAILABLE_MESSAGE
		);
	});

	it('sanitizes explicit-link configuration errors', () => {
		expect(sanitizeGoogleAuthError('manual_linking_disabled')).toBe(
			GOOGLE_AUTH_LINKING_CONFIG_MESSAGE
		);
		expect(sanitizeGoogleAuthError('LINKING_NOT_ALLOWED')).toBe(
			GOOGLE_AUTH_LINKING_CONFIG_MESSAGE
		);
	});

	it('sanitizes Better Auth provider conflict errors for explicit linking', () => {
		expect(sanitizeGoogleAuthError('identity already linked to another user')).toBe(
			GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE
		);
		expect(sanitizeGoogleAuthError('account_already_linked_to_different_user')).toBe(
			GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE
		);
	});

	it('maps cancelled/canceled/denied OAuth errors to the generic retry message', () => {
		expect(sanitizeGoogleAuthError('User cancelled the OAuth flow')).toBe(
			GOOGLE_AUTH_GENERIC_MESSAGE
		);
		expect(sanitizeGoogleAuthError('The user canceled sign-in')).toBe(
			GOOGLE_AUTH_GENERIC_MESSAGE
		);
		expect(sanitizeGoogleAuthError('access_denied')).toBe(GOOGLE_AUTH_GENERIC_MESSAGE);
	});

	it('uses a generic sanitized message for unknown errors', () => {
		expect(sanitizeGoogleAuthError('raw provider token abc')).toBe(GOOGLE_AUTH_GENERIC_MESSAGE);
	});
});
