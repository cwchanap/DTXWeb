import type { BetterAuthOptions } from 'better-auth';
import { bearer } from 'better-auth/plugins/bearer';
import { deviceAuthorization, type TimeString } from 'better-auth/plugins/device-authorization';

export type AuthConfig = {
	baseURL: string;
	secret: string;
	deviceAuthorizationExpiresIn?: string;
	webURL: string;
	cookieDomain?: string;
	cookiePrefix: string;
	googleClientId: string;
	googleClientSecret: string;
};

export const createAuthOptions = (config: AuthConfig): BetterAuthOptions => {
	const trustedWebOrigin = new URL(config.webURL).origin;

	return {
		baseURL: config.baseURL,
		secret: config.secret,
		trustedOrigins: [trustedWebOrigin],
		emailAndPassword: {
			enabled: true,
			disableSignUp: true
		},
		socialProviders: {
			google: {
				clientId: config.googleClientId,
				clientSecret: config.googleClientSecret,
				disableSignUp: true,
				disableImplicitSignUp: true
			}
		},
		account: {
			accountLinking: {
				enabled: true,
				disableImplicitLinking: true
			}
		},
		advanced: {
			cookiePrefix: config.cookiePrefix,
			crossSubDomainCookies: config.cookieDomain
				? { enabled: true, domain: config.cookieDomain }
				: { enabled: false },
			ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }
		},
		rateLimit: {
			enabled: true,
			storage: 'database',
			customRules: {
				'/get-session': false
			}
		},
		plugins: [
			deviceAuthorization({
				expiresIn: (config.deviceAuthorizationExpiresIn ?? '30m') as TimeString,
				verificationUri: `${config.webURL}/app/desktop-auth`,
				validateClient: (clientId) => clientId === 'dtx-desktop'
			}),
			bearer()
		]
	};
};
