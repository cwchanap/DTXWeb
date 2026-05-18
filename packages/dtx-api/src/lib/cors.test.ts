import { describe, it, expect } from 'vitest';
import { handlePreflight, withCors } from './cors';
import type { Env } from '../env';

const makeEnv = (origins: string): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'true',
	CORS_ALLOWED_ORIGINS: origins,
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false'
});

describe('handlePreflight', () => {
	it('returns null for non-OPTIONS requests', () => {
		const result = handlePreflight(
			new Request('https://api.test/', { method: 'GET' }),
			makeEnv('https://x.com')
		);
		expect(result).toBeNull();
	});

	it('returns 204 with ACAO + Vary when Origin is allow-listed', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com,http://localhost:5173');
		const result = handlePreflight(
			new Request('https://api.test/', {
				method: 'OPTIONS',
				headers: { Origin: 'http://localhost:5173' }
			}),
			env
		)!;
		expect(result.status).toBe(204);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		expect(result.headers.get('Vary')).toBe('Origin');
		expect(result.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
		expect(result.headers.get('Access-Control-Allow-Headers')).toBe(
			'authorization, content-type, x-requested-with'
		);
		expect(result.headers.get('Access-Control-Max-Age')).toBe('86400');
	});

	it('returns 204 without ACAO when Origin is foreign', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const result = handlePreflight(
			new Request('https://api.test/', {
				method: 'OPTIONS',
				headers: { Origin: 'https://evil.example.com' }
			}),
			env
		)!;
		expect(result.status).toBe(204);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('returns 204 without ACAO when Origin header is missing', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const result = handlePreflight(
			new Request('https://api.test/', { method: 'OPTIONS' }),
			env
		)!;
		expect(result.status).toBe(204);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('parses CORS_ALLOWED_ORIGINS with whitespace and empty entries', () => {
		const env = makeEnv('  https://a.com  ,, http://b.com  ');
		const result = handlePreflight(
			new Request('https://api.test/', {
				method: 'OPTIONS',
				headers: { Origin: 'http://b.com' }
			}),
			env
		)!;
		expect(result.headers.get('Access-Control-Allow-Origin')).toBe('http://b.com');
	});
});

describe('withCors', () => {
	it('returns response unchanged when Origin is absent', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const response = new Response('hi', { status: 200 });
		const result = withCors(response, new Request('https://api.test/'), env);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('returns response unchanged when Origin is foreign', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const response = new Response('hi', { status: 200 });
		const result = withCors(
			response,
			new Request('https://api.test/', { headers: { Origin: 'https://evil.example.com' } }),
			env
		);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('attaches ACAO+Vary when Origin is allow-listed and preserves status + headers', async () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const response = new Response('hi', { status: 201, headers: { 'X-Test': '1' } });
		const result = withCors(
			response,
			new Request('https://api.test/', {
				headers: { Origin: 'https://pre-prod.dtx.hapadona.com' }
			}),
			env
		);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBe(
			'https://pre-prod.dtx.hapadona.com'
		);
		expect(result.headers.get('Vary')).toBe('Origin');
		expect(result.headers.get('X-Test')).toBe('1');
		expect(result.status).toBe(201);
		expect(await result.text()).toBe('hi');
	});
});
