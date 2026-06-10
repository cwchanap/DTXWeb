import { describe, it, expect, vi } from 'vitest';
import { routeSetDef } from './setDef';
import type { Env } from '../env';
import type { R2Bucket } from '@cloudflare/workers-types';

const makeEnv = (get: ReturnType<typeof vi.fn>): Env =>
	({
		DB: {} as Env['DB'],
		DTXFILE_BUCKET: { get } as unknown as R2Bucket,
		RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
		SUPABASE_URL: '',
		SUPABASE_ANON_KEY: '',
		RATE_LIMIT_ENV: 'prod',
		GRAPHIQL: 'false',
		CORS_ALLOWED_ORIGINS: '',
		PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
		PUBLIC_SIMFILE_BUCKET_URL: '',
		SUPABASE_SERVICE_ROLE_KEY: ''
	}) as Env;

const req = () => new Request('https://api.test/simfiles/1002/set.def');

describe('routeSetDef', () => {
	it('rejects a non-numeric id with 400', async () => {
		const get = vi.fn();
		const res = await routeSetDef(req(), makeEnv(get), 'abc');
		expect(res.status).toBe(400);
		expect(get).not.toHaveBeenCalled();
	});

	it('returns 404 when the object is missing', async () => {
		const get = vi.fn().mockResolvedValue(null);
		const res = await routeSetDef(req(), makeEnv(get), '1002');
		expect(res.status).toBe(404);
		expect(get).toHaveBeenCalledWith('1002/set.def');
	});

	it('returns the object body when present', async () => {
		const body = new TextEncoder().encode('#TITLE Test\n');
		const get = vi.fn().mockResolvedValue({
			arrayBuffer: vi.fn().mockResolvedValue(body.buffer)
		});
		const res = await routeSetDef(req(), makeEnv(get), '1002');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/octet-stream');
		expect(await res.text()).toContain('#TITLE Test');
	});
});
