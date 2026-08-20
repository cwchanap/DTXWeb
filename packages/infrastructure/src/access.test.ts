import * as pulumi from '@pulumi/pulumi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildAccessApplicationArgs,
	buildAccessPolicy,
	createAccessApplication,
	getAccessStackDefinition,
	normalizeAccessEmail
} from './access.js';

const zeroTrustAccessApplicationMock = vi.hoisted(() => vi.fn());

vi.mock('@pulumi/cloudflare', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@pulumi/cloudflare')>();

	return {
		...actual,
		ZeroTrustAccessApplication: zeroTrustAccessApplicationMock
	};
});

beforeEach(() => {
	zeroTrustAccessApplicationMock.mockClear();
});

const resolveOutput = <T>(output: pulumi.Output<T>): Promise<T> =>
	new Promise((resolve) => {
		output.apply((value) => {
			resolve(value);
			return value;
		});
	});

describe('getAccessStackDefinition', () => {
	it('defines hostname-wide pre-production Access', () => {
		expect(getAccessStackDefinition('pre-prod')).toEqual({
			stackName: 'pre-prod',
			applicationName: 'DTXWeb Pre-prod',
			domain: 'pre-prod.dtx.hapadona.com',
			destinations: [{ type: 'public', uri: 'pre-prod.dtx.hapadona.com' }]
		});
	});

	it('defines production Access at exactly /app and /app/*', () => {
		expect(getAccessStackDefinition('production')).toEqual({
			stackName: 'production',
			applicationName: 'DTXWeb Production App',
			domain: 'dtx.hapadona.com/app',
			destinations: [
				{ type: 'public', uri: 'dtx.hapadona.com/app' },
				{ type: 'public', uri: 'dtx.hapadona.com/app/*' }
			]
		});
	});

	it('does not define hostname-wide production Access', () => {
		expect(getAccessStackDefinition('production').destinations).not.toContainEqual({
			type: 'public',
			uri: 'dtx.hapadona.com'
		});
	});

	it('rejects an unsupported stack before resource creation', () => {
		expect(() => getAccessStackDefinition('development')).toThrow(
			/Unsupported DTXWeb infrastructure stack/
		);
	});
});

describe('normalizeAccessEmail', () => {
	it('trims one email address', () => {
		expect(normalizeAccessEmail(' operator@example.com ')).toBe('operator@example.com');
	});

	it('rejects malformed and multiple email values', () => {
		expect(() => normalizeAccessEmail('not-an-email')).toThrow(/single email address/);
		expect(() => normalizeAccessEmail('a@example.com,b@example.com')).toThrow(
			/single email address/
		);
	});
});

describe('buildAccessApplicationArgs', () => {
	it('uses the default session duration and browser security flags', () => {
		const args = buildAccessApplicationArgs({
			accountId: 'account-id',
			stackDefinition: getAccessStackDefinition('pre-prod'),
			accessEmail: 'operator@example.com',
			devicePostureRuleId: 'posture-rule-id'
		});

		expect(args).toMatchObject({
			sessionDuration: '12h',
			appLauncherVisible: false,
			allowAuthenticateViaWarp: false,
			enableBindingCookie: true,
			httpOnlyCookieAttribute: true,
			pathCookieAttribute: false
		});

		expect(args.policies).toHaveLength(1);
		expect(args.policies?.[0]).toEqual({
			name: 'Allow configured operator on trusted device',
			decision: 'allow',
			precedence: 1,
			includes: [{ email: { email: expect.anything() } }],
			requires: [{ devicePosture: { integrationUid: 'posture-rule-id' } }]
		});
	});
});

describe('buildAccessPolicy', () => {
	it('uses an email Include and the supplied posture-rule Require', async () => {
		const policy = buildAccessPolicy('operator@example.com', 'posture-rule-id');
		const includedEmail = policy.includes?.[0]?.email?.email as pulumi.Output<string>;

		expect(policy).toEqual({
			name: 'Allow configured operator on trusted device',
			decision: 'allow',
			precedence: 1,
			includes: [{ email: { email: expect.anything() } }],
			requires: [{ devicePosture: { integrationUid: 'posture-rule-id' } }]
		});
		expect(await resolveOutput(includedEmail)).toBe('operator@example.com');
	});

	it('normalizes a real Pulumi Output email through the nested policy value', async () => {
		const policy = buildAccessPolicy(
			pulumi.output(' operator@example.com '),
			'posture-rule-id'
		);
		const includedEmail = policy.includes?.[0]?.email?.email as pulumi.Output<string>;

		expect(await resolveOutput(includedEmail)).toBe('operator@example.com');
	});
});

describe('createAccessApplication', () => {
	it.each([
		['pre-prod', 'dtxweb-pre-prod-access'],
		['production', 'dtxweb-production-access']
	] as const)('protects the %s application resource identity', (stack, logicalName) => {
		createAccessApplication({
			accountId: 'account-id',
			stackDefinition: getAccessStackDefinition(stack),
			accessEmail: 'operator@example.com',
			devicePostureRuleId: 'posture-rule-id'
		});

		expect(zeroTrustAccessApplicationMock).toHaveBeenLastCalledWith(
			logicalName,
			expect.objectContaining({ name: getAccessStackDefinition(stack).applicationName }),
			{ protect: true }
		);
	});
});
