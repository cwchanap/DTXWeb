import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import { createAuthOptions } from './options';
import * as authSchema from './schema';
import type { Env } from '../env';

export const createAuth = (env: Env) =>
	betterAuth({
		...createAuthOptions({
			baseURL: env.BETTER_AUTH_URL,
			webURL: env.DTX_WEB_URL,
			deviceAuthorizationExpiresIn: env.BETTER_AUTH_DEVICE_CODE_EXPIRES_IN,
			cookieDomain: env.AUTH_COOKIE_DOMAIN,
			cookiePrefix: env.AUTH_COOKIE_PREFIX,
			googleClientId: env.GOOGLE_AUTH_CLIENT_ID,
			googleClientSecret: env.GOOGLE_AUTH_CLIENT_SECRET,
			secret: env.BETTER_AUTH_SECRET
		}),
		database: drizzleAdapter(drizzle(env.DB, { schema: authSchema }), {
			provider: 'sqlite'
		})
	});
