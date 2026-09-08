import * as pulumi from '@pulumi/pulumi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildAccessApplicationArgs,
	buildAccessPolicy,
	createAccessApplication,
	getInfrastructureStackDefinition,
	normalizeAccessEmail
} from './access.js';

const zeroTrustAccessApplicationMock = vi.hoisted(() => vi.fn());
const zeroTrustDevicePostureRuleMock = vi.hoisted(() => vi.fn());

vi.mock('@pulumi/cloudflare', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@pulumi/cloudflare')>();

	return {
		...actual,
		ZeroTrustAccessApplication: zeroTrustAccessApplicationMock,
		ZeroTrustDevicePostureRule: zeroTrustDevicePostureRuleMock
	};
});

beforeEach(() => {
	zeroTrustAccessApplicationMock.mockClear();
	zeroTrustDevicePostureRuleMock.mockReset();
	zeroTrustDevicePostureRuleMock.mockReturnValue({ id: 'gateway-posture-rule-id' });
});

const resolveOutput = <T>(output: pulumi.Output<T>): Promise<T> =>
	new Promise((resolve) => {
		output.apply((value) => {
			resolve(value);
			return value;
		});
	});

describe('getInfrastructureStackDefinition', () => {
	it('defines the pre-production data and domain targets', () => {
		expect(getInfrastructureStackDefinition('pre-prod')).toMatchObject({
			stackName: 'pre-prod',
			webWorkerName: 'dtx-web-pre-prod',
			apiWorkerName: 'dtx-api-pre-prod',
			webHostname: 'pre-prod.dtx.hapadona.com',
			apiHostname: 'api.pre-prod.dtx.hapadona.com',
			databaseName: 'dtx-web-preprod',
			bucketName: 'simfile-dtx-preprod'
		});
	});

	it('keeps hostname-wide pre-production Access', () => {
		expect(getInfrastructureStackDefinition('pre-prod')).toMatchObject({
			applicationName: 'DTXWeb Pre-prod',
			accessDomain: 'pre-prod.dtx.hapadona.com',
			accessDestinations: [{ type: 'public', uri: 'pre-prod.dtx.hapadona.com' }],
			rateLimitKvTitle: 'pre-prod-RATE_LIMIT_API',
			r2Location: 'WNAM'
		});
	});

	it('defines production Access at exactly /app and /app/*', () => {
		expect(getInfrastructureStackDefinition('production')).toMatchObject({
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
			rateLimitKvTitle: 'RATE_LIMIT_API',
			r2Location: 'APAC'
		});
	});

	it('does not define hostname-wide production Access', () => {
		expect(
			getInfrastructureStackDefinition('production').accessDestinations
		).not.toContainEqual({
			type: 'public',
			uri: 'dtx.hapadona.com'
		});
	});

	it('rejects an unsupported stack before resource creation', () => {
		expect(() => getInfrastructureStackDefinition('development')).toThrow(
			/Unsupported DTXWeb infrastructure stack/
		);
	});

	it('rejects the pre-prod-prod-data alias stack', () => {
		expect(() => getInfrastructureStackDefinition('pre-prod-prod-data')).toThrow(
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
			stackDefinition: getInfrastructureStackDefinition('pre-prod'),
			accessEmail: 'operator@example.com',
			devicePostureRuleId: 'posture-rule-id'
		});

		expect(args).toMatchObject({
			sessionDuration: '12h',
			appLauncherVisible: false,
			allowAuthenticateViaWarp: false,
			enableBindingCookie: true,
			httpOnlyCookieAttribute: true,
			pathCookieAttribute: true
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
	] as const)('creates a DTXWeb-owned Gateway posture rule for %s', (stack, logicalName) => {
		const args = {
			accountId: 'account-id',
			stackDefinition: getInfrastructureStackDefinition(stack),
			accessEmail: 'operator@example.com'
		} as Parameters<typeof createAccessApplication>[0];

		createAccessApplication(args);

		expect(zeroTrustDevicePostureRuleMock).toHaveBeenLastCalledWith(
			'dtxweb-gateway-posture',
			{
				accountId: 'account-id',
				name: 'DTXWeb Gateway Check',
				type: 'gateway',
				description: 'Requires Cloudflare One Client connected to this Zero Trust account'
			}
		);
		expect(zeroTrustAccessApplicationMock).toHaveBeenLastCalledWith(
			logicalName,
			expect.objectContaining({
				name: getInfrastructureStackDefinition(stack).applicationName,
				policies: [
					expect.objectContaining({
						requires: [
							{ devicePosture: { integrationUid: 'gateway-posture-rule-id' } }
						]
					})
				]
			}),
			{ protect: true, dependsOn: expect.anything() }
		);
	});
});
