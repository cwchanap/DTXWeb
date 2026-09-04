import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkersCustomDomains } from './domains.js';
import { getInfrastructureStackDefinition } from './access.js';

const workersCustomDomainMock = vi.hoisted(() => vi.fn());
const workerMock = vi.hoisted(() => vi.fn());

vi.mock('@pulumi/cloudflare', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@pulumi/cloudflare')>();

	return {
		...actual,
		WorkersCustomDomain: workersCustomDomainMock,
		Worker: workerMock
	};
});

beforeEach(() => {
	workersCustomDomainMock.mockClear();
	workerMock.mockClear();
});

describe('createWorkersCustomDomains', () => {
	it('attaches exactly the two pre-production Worker custom domains', () => {
		createWorkersCustomDomains({
			accountId: 'account-id',
			zoneId: 'zone-id',
			stackDefinition: getInfrastructureStackDefinition('pre-prod')
		});

		expect(workersCustomDomainMock).toHaveBeenCalledTimes(2);
		expect(workersCustomDomainMock).toHaveBeenCalledWith(
			'dtxweb-pre-prod-web-domain',
			expect.objectContaining({
				hostname: 'pre-prod.dtx.hapadona.com',
				service: 'dtx-web-pre-prod',
				zoneId: 'zone-id'
			}),
			{ protect: true }
		);
		expect(workersCustomDomainMock).toHaveBeenCalledWith(
			'dtxweb-pre-prod-api-domain',
			expect.objectContaining({
				hostname: 'api.pre-prod.dtx.hapadona.com',
				service: 'dtx-api-pre-prod',
				zoneId: 'zone-id'
			}),
			{ protect: true }
		);
	});

	it('attaches exactly the two production Worker custom domains', () => {
		createWorkersCustomDomains({
			accountId: 'account-id',
			zoneId: 'zone-id',
			stackDefinition: getInfrastructureStackDefinition('production')
		});

		expect(workersCustomDomainMock).toHaveBeenCalledTimes(2);
		expect(workersCustomDomainMock).toHaveBeenCalledWith(
			'dtxweb-production-web-domain',
			expect.objectContaining({
				hostname: 'dtx.hapadona.com',
				service: 'dtx-web',
				zoneId: 'zone-id'
			}),
			{ protect: true }
		);
		expect(workersCustomDomainMock).toHaveBeenCalledWith(
			'dtxweb-production-api-domain',
			expect.objectContaining({
				hostname: 'api.dtx.hapadona.com',
				service: 'dtx-api',
				zoneId: 'zone-id'
			}),
			{ protect: true }
		);
	});

	it('never declares a Worker script', () => {
		createWorkersCustomDomains({
			accountId: 'account-id',
			zoneId: 'zone-id',
			stackDefinition: getInfrastructureStackDefinition('pre-prod')
		});

		expect(workerMock).not.toHaveBeenCalled();
	});
});
