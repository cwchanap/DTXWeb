import * as pulumi from '@pulumi/pulumi';
import { createAccessApplication, getInfrastructureStackDefinition } from './access.js';
import { createD1Database, createR2Bucket, createRateLimitKvNamespace } from './data.js';
import { createWorkersCustomDomains } from './domains.js';

const stackDefinition = getInfrastructureStackDefinition(pulumi.getStack());
const config = new pulumi.Config();
const accountId = config.require('cloudflareAccountId');

const accessApplication = createAccessApplication({
	accountId,
	stackDefinition,
	accessEmail: config.requireSecret('accessEmail'),
	sessionDuration: config.get('accessSessionDuration')
});

const d1Database = createD1Database({
	accountId,
	stackDefinition
});

const r2Bucket = createR2Bucket({
	accountId,
	stackDefinition
});

const rateLimitKvNamespace = createRateLimitKvNamespace({
	accountId,
	stackDefinition
});

const workersCustomDomains = createWorkersCustomDomains({
	accountId,
	zoneId: config.require('cloudflareZoneId'),
	stackDefinition
});

export const accessApplicationId: pulumi.Output<string> = accessApplication.id;
export const d1DatabaseId: pulumi.Output<string> = d1Database.id;
export const r2BucketName: pulumi.Output<string> = r2Bucket.name;
export const rateLimitKvNamespaceId: pulumi.Output<string> = rateLimitKvNamespace.id;
export const webDomainHostname: pulumi.Output<string> = workersCustomDomains[0].hostname;
export const apiDomainHostname: pulumi.Output<string> = workersCustomDomains[1].hostname;
