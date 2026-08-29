import * as pulumi from '@pulumi/pulumi';
import { createAccessApplication, getInfrastructureStackDefinition } from './access.js';
import { createD1Database, createR2Bucket, createRateLimitKvNamespace } from './data.js';
import { createWorkersCustomDomains } from './domains.js';

const stackDefinition = getInfrastructureStackDefinition(pulumi.getStack());
const config = new pulumi.Config();

const accessApplication = createAccessApplication({
	accountId: config.require('cloudflareAccountId'),
	stackDefinition,
	accessEmail: config.requireSecret('accessEmail'),
	devicePostureRuleId: config.require('devicePostureRuleId'),
	sessionDuration: config.get('accessSessionDuration')
});

const d1Database = createD1Database({
	accountId: config.require('cloudflareAccountId'),
	stackDefinition
});

const r2Bucket = createR2Bucket({
	accountId: config.require('cloudflareAccountId'),
	stackDefinition
});

const rateLimitKvNamespace = createRateLimitKvNamespace({
	accountId: config.require('cloudflareAccountId'),
	stackDefinition
});

const workersCustomDomains = createWorkersCustomDomains({
	accountId: config.require('cloudflareAccountId'),
	zoneId: config.require('cloudflareZoneId'),
	stackDefinition
});

export const accessApplicationId = accessApplication.id;
export const d1DatabaseId = d1Database.id;
export const r2BucketName = r2Bucket.name;
export const rateLimitKvNamespaceId = rateLimitKvNamespace.id;
export const webDomainHostname = workersCustomDomains[0].hostname;
export const apiDomainHostname = workersCustomDomains[1].hostname;
