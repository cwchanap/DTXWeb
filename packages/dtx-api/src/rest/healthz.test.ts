import { describe, it, expect } from 'vitest';
import { healthz } from './healthz';
import type { Env } from '../env';

const env: Env = {
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	BETTER_AUTH_URL: 'https://api.test',
	BETTER_AUTH_SECRET: 'test-secret',
	DTX_WEB_URL: 'http://localhost:5173',
	AUTH_COOKIE_PREFIX: 'dtx-test',
	GOOGLE_AUTH_CLIENT_ID: 'google-client-id',
	GOOGLE_AUTH_CLIENT_SECRET: 'google-client-secret',
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'true',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: ''
};

describe('healthz', () => {
	it('returns 200 with application/json content-type', () => {
		const response = healthz(new Request('https://api.test/healthz'), env);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
	});

	it('body includes ok=true, service, version, buildSha', async () => {
		const response = healthz(new Request('https://api.test/healthz'), env);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ ok: true, service: 'dtx-api' });
		expect(typeof body.version).toBe('string');
		expect(typeof body.buildSha).toBe('string');
	});
});
