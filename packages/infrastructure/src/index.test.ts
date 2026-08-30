import * as pulumi from '@pulumi/pulumi';
import type { MockResourceArgs } from '@pulumi/pulumi/runtime';
import { describe, expect, it } from 'vitest';

const resolveOutput = <T>(output: pulumi.Output<T>): Promise<T> =>
	new Promise((resolve) => {
		output.apply((value) => {
			resolve(value);
			return value;
		});
	});

describe('stack registration', () => {
	it('registers the exact expanded production stack', async () => {
		const resources: MockResourceArgs[] = [];

		await pulumi.runtime.setMocks(
			{
				call: () => ({}),
				newResource: (args) => {
					resources.push(args);
					return { id: `${args.name}-id`, state: args.inputs };
				}
			},
			'dtxweb-infrastructure',
			'production'
		);
		pulumi.runtime.setAllConfig(
			{
				'dtxweb-infrastructure:cloudflareAccountId': 'account-id',
				'dtxweb-infrastructure:cloudflareZoneId': 'zone-id',
				'dtxweb-infrastructure:accessEmail': 'operator@example.com',
				'dtxweb-infrastructure:devicePostureRuleId': 'posture-rule-id'
			},
			['dtxweb-infrastructure:accessEmail']
		);

		const index = await import('./index.js');
		await Promise.all(Object.values(index).map((output) => resolveOutput(output as any)));

		const cloudflareResources = resources.filter((resource) =>
			resource.type.startsWith('cloudflare:')
		);
		const typeOf = (typeName: string) =>
			cloudflareResources.filter((resource) => resource.type === typeName);

		expect(cloudflareResources).toHaveLength(6);
		expect(
			typeOf('cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication')
		).toHaveLength(1);
		expect(typeOf('cloudflare:index/d1Database:D1Database')).toHaveLength(1);
		expect(typeOf('cloudflare:index/r2Bucket:R2Bucket')).toHaveLength(1);
		expect(typeOf('cloudflare:index/workersKvNamespace:WorkersKvNamespace')).toHaveLength(1);
		expect(typeOf('cloudflare:index/workersCustomDomain:WorkersCustomDomain')).toHaveLength(2);

		const forbiddenTypes = [
			'worker:Worker',
			'r2BucketCors',
			'r2ManagedDomain',
			'r2CustomDomain'
		];
		expect(
			cloudflareResources.filter((resource) =>
				forbiddenTypes.some((forbidden) => resource.type.includes(forbidden))
			)
		).toEqual([]);
	}, 15000);
});
