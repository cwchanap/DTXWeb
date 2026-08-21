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

export interface AccessDestination {
	type: 'public';
	uri: string;
}

export interface AccessStackDefinition {
	stackName: 'pre-prod' | 'production';
	applicationName: string;
	domain: string;
	destinations: AccessDestination[];
}

const ACCESS_STACKS: Record<AccessStackDefinition['stackName'], AccessStackDefinition> = {
	'pre-prod': {
		stackName: 'pre-prod',
		applicationName: 'DTXWeb Pre-prod',
		domain: 'pre-prod.dtx.hapadona.com',
		destinations: [{ type: 'public', uri: 'pre-prod.dtx.hapadona.com' }]
	},
	production: {
		stackName: 'production',
		applicationName: 'DTXWeb Production App',
		domain: 'dtx.hapadona.com/app',
		destinations: [
			{ type: 'public', uri: 'dtx.hapadona.com/app' },
			{ type: 'public', uri: 'dtx.hapadona.com/app/*' }
		]
	}
};

export function getAccessStackDefinition(stackName: string): AccessStackDefinition {
	if (stackName !== 'pre-prod' && stackName !== 'production') {
		throw new Error(`Unsupported DTXWeb infrastructure stack: ${stackName}`);
	}

	return ACCESS_STACKS[stackName];
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
	devicePostureRuleId: pulumi.Input<string>
): AccessPolicy {
	const normalizedAccessEmail = pulumi.output(accessEmail).apply(normalizeAccessEmail);

	return {
		name: 'Allow configured operator on trusted device',
		decision: 'allow',
		precedence: 1,
		includes: [{ email: { email: normalizedAccessEmail } }],
		requires: [{ devicePosture: { integrationUid: devicePostureRuleId } }]
	};
}

export interface BuildAccessApplicationArgs {
	accountId: pulumi.Input<string>;
	stackDefinition: AccessStackDefinition;
	accessEmail: pulumi.Input<string>;
	devicePostureRuleId: pulumi.Input<string>;
	sessionDuration?: pulumi.Input<string>;
}

export function buildAccessApplicationArgs(
	args: BuildAccessApplicationArgs
): AccessApplicationArgs {
	return {
		accountId: args.accountId,
		name: args.stackDefinition.applicationName,
		type: 'self_hosted',
		domain: args.stackDefinition.domain,
		destinations: args.stackDefinition.destinations,
		sessionDuration: args.sessionDuration ?? DEFAULT_ACCESS_SESSION_DURATION,
		...ACCESS_APPLICATION_FLAGS,
		policies: [buildAccessPolicy(args.accessEmail, args.devicePostureRuleId)]
	};
}

export function createAccessApplication(
	args: BuildAccessApplicationArgs
): cloudflare.ZeroTrustAccessApplication {
	return new cloudflare.ZeroTrustAccessApplication(
		`dtxweb-${args.stackDefinition.stackName}-access`,
		buildAccessApplicationArgs(args),
		{ protect: true }
	);
}
