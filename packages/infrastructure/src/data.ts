import * as cloudflare from '@pulumi/cloudflare';
import type * as pulumi from '@pulumi/pulumi';
import type { InfrastructureStackDefinition } from './access.js';

export interface DataStackArgs {
	accountId: pulumi.Input<string>;
	stackDefinition: InfrastructureStackDefinition;
}

export function createD1Database(args: DataStackArgs): cloudflare.D1Database {
	return new cloudflare.D1Database(
		`dtxweb-${args.stackDefinition.stackName}-d1`,
		{
			accountId: args.accountId,
			name: args.stackDefinition.databaseName,
			readReplication: { mode: 'disabled' }
		},
		{ protect: true, retainOnDelete: true }
	);
}

export function createR2Bucket(args: DataStackArgs): cloudflare.R2Bucket {
	return new cloudflare.R2Bucket(
		`dtxweb-${args.stackDefinition.stackName}-r2`,
		{
			accountId: args.accountId,
			name: args.stackDefinition.bucketName,
			jurisdiction: 'default',
			location: args.stackDefinition.r2Location,
			storageClass: 'Standard'
		},
		{ protect: true, retainOnDelete: true }
	);
}

export function createRateLimitKvNamespace(args: DataStackArgs): cloudflare.WorkersKvNamespace {
	return new cloudflare.WorkersKvNamespace(
		`dtxweb-${args.stackDefinition.stackName}-rate-limit-kv`,
		{
			accountId: args.accountId,
			title: args.stackDefinition.rateLimitKvTitle
		},
		{ protect: true }
	);
}
