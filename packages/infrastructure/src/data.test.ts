import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1Database, createR2Bucket, createRateLimitKvNamespace } from './data.js';
import { getInfrastructureStackDefinition } from './access.js';

const d1DatabaseMock = vi.hoisted(() => vi.fn());
const r2BucketMock = vi.hoisted(() => vi.fn());
const kvNamespaceMock = vi.hoisted(() => vi.fn());

vi.mock('@pulumi/cloudflare', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@pulumi/cloudflare')>();

	return {
		...actual,
		D1Database: d1DatabaseMock,
		R2Bucket: r2BucketMock,
		WorkersKvNamespace: kvNamespaceMock
	};
});

beforeEach(() => {
	d1DatabaseMock.mockClear();
	r2BucketMock.mockClear();
	kvNamespaceMock.mockClear();
});

describe('createD1Database', () => {
	it('imports-protects the pre-production database with its live name', () => {
		createD1Database({
			accountId: 'account-id',
			stackDefinition: getInfrastructureStackDefinition('pre-prod')
		});

		expect(d1DatabaseMock).toHaveBeenCalledWith(
			'dtxweb-pre-prod-d1',
			expect.objectContaining({
				name: 'dtx-web-preprod',
				readReplication: { mode: 'disabled' }
			}),
			{ protect: true, retainOnDelete: true }
		);
	});

	it('declares the production database under the import identity', () => {
		createD1Database({
			accountId: 'account-id',
			stackDefinition: getInfrastructureStackDefinition('production')
		});

		expect(d1DatabaseMock).toHaveBeenCalledWith(
			'dtxweb-production-d1',
			expect.objectContaining({ name: 'dtx-web' }),
			{ protect: true, retainOnDelete: true }
		);
	});
});

describe('createR2Bucket', () => {
	it('reproduces the live pre-production bucket inputs', () => {
		createR2Bucket({
			accountId: 'account-id',
			stackDefinition: getInfrastructureStackDefinition('pre-prod')
		});

		expect(r2BucketMock).toHaveBeenCalledWith(
			'dtxweb-pre-prod-r2',
			expect.objectContaining({
				name: 'simfile-dtx-preprod',
				jurisdiction: 'default',
				location: 'WNAM',
				storageClass: 'Standard'
			}),
			{ protect: true, retainOnDelete: true }
		);
	});

	it('keeps the production bucket in its live APAC location', () => {
		createR2Bucket({
			accountId: 'account-id',
			stackDefinition: getInfrastructureStackDefinition('production')
		});

		expect(r2BucketMock).toHaveBeenCalledWith(
			'dtxweb-production-r2',
			expect.objectContaining({ name: 'simfile-dtx', location: 'APAC' }),
			{ protect: true, retainOnDelete: true }
		);
	});
});

describe('createRateLimitKvNamespace', () => {
	it('uses the imported pre-production namespace title', () => {
		createRateLimitKvNamespace({
			accountId: 'account-id',
			stackDefinition: getInfrastructureStackDefinition('pre-prod')
		});

		expect(kvNamespaceMock).toHaveBeenCalledWith(
			'dtxweb-pre-prod-rate-limit-kv',
			expect.objectContaining({ title: expect.any(String) }),
			{ protect: true }
		);
	});

	it('uses the imported production namespace title', () => {
		createRateLimitKvNamespace({
			accountId: 'account-id',
			stackDefinition: getInfrastructureStackDefinition('production')
		});

		expect(kvNamespaceMock).toHaveBeenCalledWith(
			'dtxweb-production-rate-limit-kv',
			expect.objectContaining({ title: expect.any(String) }),
			{ protect: true }
		);
	});
});
