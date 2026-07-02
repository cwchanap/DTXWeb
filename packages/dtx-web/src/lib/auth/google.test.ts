import { describe, expect, it } from 'vitest';
import {
	GOOGLE_AUTH_LINKING_CONFIG_MESSAGE,
	GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE,
	GOOGLE_AUTH_UNAVAILABLE_MESSAGE,
	appendSearchParam,
	buildAccountCallbackUrl,
	buildAuthCallbackUrl,
	buildLoginErrorRedirect,
	buildLinkedAccountRedirect,
	safeAppRedirectPath,
	sanitizeGoogleAuthError
} from './google';

describe('google auth helpers', () => {
	it('builds a standard auth callback URL', () => {
		expect(buildAuthCallbackUrl('https://dtx.example')).toBe(
			'https://dtx.example/auth/callback'
		);
	});

	it('builds a desktop auth callback URL', () => {
		expect(buildAuthCallbackUrl('https://dtx.example/', 'desktop')).toBe(
			'https://dtx.example/auth/callback?redirect=desktop'
		);
	});

	it('builds an account-linking callback URL', () => {
		expect(buildAccountCallbackUrl('https://dtx.example')).toBe(
			'https://dtx.example/auth/callback?link=google&next=%2Fapp%2Faccount'
		);
	});

	it('rejects open redirects outside the app', () => {
		expect(safeAppRedirectPath('https://evil.example')).toBe('/app/account');
		expect(safeAppRedirectPath('//evil.example')).toBe('/app/account');
		expect(safeAppRedirectPath('/login')).toBe('/app/account');
		expect(safeAppRedirectPath('/application')).toBe('/app/account');
		expect(safeAppRedirectPath('/app.evil')).toBe('/app/account');
		expect(safeAppRedirectPath('/app/chart')).toBe('/app/chart');
	});

	it('builds login error redirects while preserving desktop intent', () => {
		expect(buildLoginErrorRedirect('Sign-in failed')).toBe('/login?error=Sign-in+failed');
		expect(buildLoginErrorRedirect('Sign-in failed', 'desktop')).toBe(
			'/login?redirect=desktop&error=Sign-in+failed'
		);
	});

	it('builds linked account redirects with success and error messages', () => {
		expect(buildLinkedAccountRedirect('/app/account', 'connected')).toBe(
			'/app/account?linked=google'
		);
		expect(buildLinkedAccountRedirect('/app/account', 'error', 'Denied')).toBe(
			'/app/account?auth_error=Denied'
		);
	});

	it('appends search params to paths with existing params', () => {
		expect(appendSearchParam('/app/account?tab=security', 'linked', 'google')).toBe(
			'/app/account?tab=security&linked=google'
		);
	});

	it('sanitizes signup-disabled style errors for login', () => {
		expect(sanitizeGoogleAuthError('Signups not allowed for this instance')).toBe(
			GOOGLE_AUTH_UNAVAILABLE_MESSAGE
		);
	});

	it('sanitizes manual-linking-disabled errors for account linking', () => {
		expect(sanitizeGoogleAuthError('manual_linking_disabled')).toBe(
			GOOGLE_AUTH_LINKING_CONFIG_MESSAGE
		);
	});

	it('sanitizes provider conflict errors for account linking', () => {
		expect(sanitizeGoogleAuthError('identity already linked to another user')).toBe(
			GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE
		);
	});

	it('uses a generic sanitized message for unknown errors', () => {
		expect(sanitizeGoogleAuthError('raw provider token abc')).toBe(
			GOOGLE_AUTH_UNAVAILABLE_MESSAGE
		);
	});
});
