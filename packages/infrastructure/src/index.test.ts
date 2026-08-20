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
	it('registers one production Access application resource', async () => {
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
				'dtxweb-infrastructure:accessEmail': 'operator@example.com',
				'dtxweb-infrastructure:devicePostureRuleId': 'posture-rule-id'
			},
			['dtxweb-infrastructure:accessEmail']
		);

		const { accessApplicationId } = await import('./index.js');
		await resolveOutput(accessApplicationId);

		const cloudflareResources = resources.filter((resource) =>
			resource.type.startsWith('cloudflare:')
		);
		expect(cloudflareResources).toHaveLength(1);
		expect(cloudflareResources[0]).toMatchObject({
			type: 'cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication',
			name: 'dtxweb-production-access'
		});
	});
});
