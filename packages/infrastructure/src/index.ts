import * as pulumi from '@pulumi/pulumi';
import { createAccessApplication, getAccessStackDefinition } from './access.js';

const stackDefinition = getAccessStackDefinition(pulumi.getStack());
const config = new pulumi.Config();

const accessApplication = createAccessApplication({
	accountId: config.require('cloudflareAccountId'),
	stackDefinition,
	accessEmail: config.requireSecret('accessEmail'),
	devicePostureRuleId: config.require('devicePostureRuleId'),
	sessionDuration: config.get('accessSessionDuration')
});

export const accessApplicationId = accessApplication.id;
