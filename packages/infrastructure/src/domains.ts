import * as cloudflare from '@pulumi/cloudflare';
import type * as pulumi from '@pulumi/pulumi';
import type { InfrastructureStackDefinition } from './access.js';

export interface WorkersCustomDomainsArgs {
	accountId: pulumi.Input<string>;
	zoneId: pulumi.Input<string>;
	stackDefinition: InfrastructureStackDefinition;
}

export function createWorkersCustomDomains(
	args: WorkersCustomDomainsArgs
): cloudflare.WorkersCustomDomain[] {
	const { stackDefinition } = args;

	return [
		new cloudflare.WorkersCustomDomain(
			`dtxweb-${stackDefinition.stackName}-web-domain`,
			{
				accountId: args.accountId,
				hostname: stackDefinition.webHostname,
				service: stackDefinition.webWorkerName,
				zoneId: args.zoneId
			},
			{ protect: true }
		),
		new cloudflare.WorkersCustomDomain(
			`dtxweb-${stackDefinition.stackName}-api-domain`,
			{
				accountId: args.accountId,
				hostname: stackDefinition.apiHostname,
				service: stackDefinition.apiWorkerName,
				zoneId: args.zoneId
			},
			{ protect: true }
		)
	];
}
