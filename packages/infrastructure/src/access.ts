import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';

const ACCESS_EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export const DEFAULT_ACCESS_SESSION_DURATION = '12h';

export const ACCESS_APPLICATION_FLAGS = {
	appLauncherVisible: false,
	allowAuthenticateViaWarp: false,
	enableBindingCookie: true,
	httpOnlyCookieAttribute: true,
	pathCookieAttribute: true
} as const;

export type StackName = 'pre-prod' | 'production';

export interface AccessDestination {
	type: 'public';
	uri: string;
}

export interface InfrastructureStackDefinition {
	stackName: StackName;
	applicationName: string;
	accessDomain: string;
	accessDestinations: AccessDestination[];
	webWorkerName: string;
	apiWorkerName: string;
	webHostname: string;
	apiHostname: string;
	databaseName: string;
	bucketName: string;
	r2Location: string;
	rateLimitKvTitle: string;
}

const INFRASTRUCTURE_STACKS: Record<StackName, InfrastructureStackDefinition> = {
	'pre-prod': {
		stackName: 'pre-prod',
		applicationName: 'DTXWeb Pre-prod',
		accessDomain: 'pre-prod.dtx.hapadona.com',
		accessDestinations: [{ type: 'public', uri: 'pre-prod.dtx.hapadona.com' }],
		webWorkerName: 'dtx-web-pre-prod',
		apiWorkerName: 'dtx-api-pre-prod',
		webHostname: 'pre-prod.dtx.hapadona.com',
		apiHostname: 'api.pre-prod.dtx.hapadona.com',
		databaseName: 'dtx-web-preprod',
		bucketName: 'simfile-dtx-preprod',
		r2Location: 'WNAM',
		rateLimitKvTitle: 'pre-prod-RATE_LIMIT_API'
	},
	production: {
		stackName: 'production',
		applicationName: 'DTXWeb Production App',
		accessDomain: 'dtx.hapadona.com/app',
		accessDestinations: [
			{ type: 'public', uri: 'dtx.hapadona.com/app' },
			{ type: 'public', uri: 'dtx.hapadona.com/app/*' }
		],
		webWorkerName: 'dtx-web',
		apiWorkerName: 'dtx-api',
		webHostname: 'dtx.hapadona.com',
		apiHostname: 'api.dtx.hapadona.com',
		databaseName: 'dtx-web',
		bucketName: 'simfile-dtx',
		r2Location: 'APAC',
		rateLimitKvTitle: 'RATE_LIMIT_API'
	}
};

export function getInfrastructureStackDefinition(stackName: string): InfrastructureStackDefinition {
	if (stackName !== 'pre-prod' && stackName !== 'production') {
		throw new Error(`Unsupported DTXWeb infrastructure stack: ${stackName}`);
	}

	return INFRASTRUCTURE_STACKS[stackName];
}

export function normalizeAccessEmail(rawValue: string): string {
	const value = rawValue.trim();
	if (!ACCESS_EMAIL_PATTERN.test(value)) {
		throw new Error('accessEmail must be a single email address');
	}

	return value;
}

type AccessPolicy = cloudflare.types.input.ZeroTrustAccessApplicationPolicy;
type AccessApplicationArgs = cloudflare.ZeroTrustAccessApplicationArgs;

export function buildAccessPolicy(
	accessEmail: pulumi.Input<string>,
	gatewayPostureRuleId: pulumi.Input<string>
): AccessPolicy {
	const normalizedAccessEmail = pulumi.output(accessEmail).apply(normalizeAccessEmail);

	return {
		name: 'Allow configured operator on trusted device',
		decision: 'allow',
		precedence: 1,
		includes: [{ email: { email: normalizedAccessEmail } }],
		requires: [{ devicePosture: { integrationUid: gatewayPostureRuleId } }]
	};
}

export interface BuildAccessApplicationArgs {
	accountId: pulumi.Input<string>;
	stackDefinition: InfrastructureStackDefinition;
	accessEmail: pulumi.Input<string>;
	gatewayPostureRuleId: pulumi.Input<string>;
	sessionDuration?: pulumi.Input<string>;
}

export interface CreateAccessApplicationArgs {
	accountId: pulumi.Input<string>;
	stackDefinition: InfrastructureStackDefinition;
	accessEmail: pulumi.Input<string>;
	sessionDuration?: pulumi.Input<string>;
}

export function buildAccessApplicationArgs(
	args: BuildAccessApplicationArgs
): AccessApplicationArgs {
	return {
		accountId: args.accountId,
		name: args.stackDefinition.applicationName,
		type: 'self_hosted',
		domain: args.stackDefinition.accessDomain,
		destinations: args.stackDefinition.accessDestinations,
		sessionDuration: args.sessionDuration ?? DEFAULT_ACCESS_SESSION_DURATION,
		...ACCESS_APPLICATION_FLAGS,
		policies: [buildAccessPolicy(args.accessEmail, args.gatewayPostureRuleId)]
	};
}

export function createAccessApplication(
	args: CreateAccessApplicationArgs
): cloudflare.ZeroTrustAccessApplication {
	const gatewayPostureRule = new cloudflare.ZeroTrustDevicePostureRule(
		`dtxweb-${args.stackDefinition.stackName}-gateway-posture`,
		{
			accountId: args.accountId,
			name: `${args.stackDefinition.applicationName} Gateway Check`,
			type: 'gateway',
			description: 'Requires Cloudflare One Client connected to this Zero Trust account',
			expiration: '10m'
		}
	);

	return new cloudflare.ZeroTrustAccessApplication(
		`dtxweb-${args.stackDefinition.stackName}-access`,
		buildAccessApplicationArgs({
			...args,
			gatewayPostureRuleId: gatewayPostureRule.id
		}),
		{ protect: true, dependsOn: [gatewayPostureRule] }
	);
}
