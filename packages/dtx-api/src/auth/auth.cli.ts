import { betterAuth } from 'better-auth';
import { createAuthOptions } from './options';

export default betterAuth(
	createAuthOptions({
		baseURL: 'http://localhost:8787',
		secret: 'schema-generation-secret-0123456789abcdef0123456789abcdef',
		webURL: 'http://localhost:5173',
		cookiePrefix: 'dtx-local',
		googleClientId: 'schema-generation-google-client-id',
		googleClientSecret: 'schema-generation-google-client-secret'
	})
);
