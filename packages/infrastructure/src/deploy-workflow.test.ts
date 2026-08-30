import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = new URL(
	'../../../.github/workflows/deploy-cloudflare-infrastructure.yml',
	import.meta.url
);

const countOccurrences = (text: string, value: string): number => text.split(value).length - 1;
const checkoutAction = 'uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0';
const setupBunAction = 'uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2';
const pulumiAction = 'uses: pulumi/actions@8582a9e8cc630786854029b4e09281acd6794b58';
const mainRefGuard = "if: github.ref == 'refs/heads/main'";
const suppressOutputs = 'suppress-outputs: true';

describe('committed Pulumi stack settings', () => {
	it.each(['Pulumi.pre-prod.yaml', 'Pulumi.production.yaml'])(
		'%s preserves the stack settings contract',
		(file) => {
			const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

			expect(text).not.toContain('secretsprovider:');
			expect(text).toMatch(/dtxweb-infrastructure:accessEmail:\s*\n\s+secure:/);
			expect(text).toMatch(/dtxweb-infrastructure:devicePostureRuleId:/);
			expect(text).toContain('dtxweb-infrastructure:cloudflareAccountId:');
			expect(text).not.toContain('encryptionsalt:');
		}
	);
});

describe('automatic Cloudflare infrastructure deployment workflow', () => {
	it('keeps the serial deployment and CI contract', () => {
		const workflowExists = existsSync(workflowPath);

		expect(workflowExists).toBe(true);
		if (!workflowExists) return;

		const text = readFileSync(workflowPath, 'utf8');
		const preProdJobStart = text.indexOf('  deploy-pre-prod:');
		const productionJobStart = text.indexOf('  deploy-production:');
		const preProdJob = text.slice(preProdJobStart, productionJobStart);
		const productionJob = text.slice(productionJobStart);

		expect(text).toContain('name: Deploy Cloudflare Infrastructure');
		expect(text).toContain('branches: [main]');
		expect(text).toContain("'packages/infrastructure/**'");
		expect(text).toContain("'bun.lock'");
		expect(text).toContain("'package.json'");
		expect(text).toContain("'tsconfig.base.json'");
		expect(text).toContain("'.github/workflows/deploy-cloudflare-infrastructure.yml'");
		expect(text).toContain('workflow_dispatch:');
		expect(text).not.toContain('pull_request:');

		expect(text).toContain('contents: read');
		expect(text).toContain('id-token: write');
		expect(text).toContain('group: ${{ github.workflow }}-${{ github.ref }}');
		expect(text).toContain('cancel-in-progress: false');

		expect(text.match(/^\s{2}deploy-[^:]+:/gm)).toHaveLength(2);
		expect(preProdJobStart).toBeGreaterThan(-1);
		expect(productionJobStart).toBeGreaterThan(preProdJobStart);
		expect(productionJob).toContain('needs: deploy-pre-prod');
		expect(preProdJob).toContain('environment: dtx-access-pre-prod');
		expect(productionJob).toContain('environment: dtx-access-production');
		expect(preProdJob).toContain('cwchanap/dtxweb-infrastructure/pre-prod');
		expect(productionJob).toContain('cwchanap/dtxweb-infrastructure/production');
		expect(countOccurrences(text, mainRefGuard)).toBe(2);
		expect(countOccurrences(text, suppressOutputs)).toBe(2);

		for (const command of [
			'bun run --filter=@dtx/infrastructure check',
			'bun run --filter=@dtx/infrastructure test:coverage',
			'bun run --filter=@dtx/infrastructure build',
			'test -f packages/infrastructure/dist/index.js'
		]) {
			expect(countOccurrences(text, command)).toBe(2);
		}

		for (const [job, stack, verifier] of [
			[
				preProdJob,
				'cwchanap/dtxweb-infrastructure/pre-prod',
				'packages/infrastructure/scripts/verify-access.sh pre-prod'
			],
			[
				productionJob,
				'cwchanap/dtxweb-infrastructure/production',
				'packages/infrastructure/scripts/verify-access.sh production'
			]
		] as const) {
			expect(countOccurrences(job, checkoutAction)).toBe(1);
			expect(countOccurrences(job, setupBunAction)).toBe(1);
			expect(job).not.toContain('uses: actions/checkout@v');
			expect(job).not.toContain('uses: oven-sh/setup-bun@v');
			expect(countOccurrences(job, mainRefGuard)).toBe(1);
			expect(countOccurrences(job, suppressOutputs)).toBe(1);
			expect(
				countOccurrences(
					job,
					'uses: pulumi/auth-actions@1c89817aab0c66407723cdef72b05266e7376640'
				)
			).toBe(1);
			expect(countOccurrences(job, pulumiAction)).toBe(2);
			expect(countOccurrences(job, 'command: up')).toBe(1);
			const driftCheck = `run: pulumi refresh --preview-only --expect-no-changes --stack ${stack}`;
			const driftCheckIndex = job.indexOf(driftCheck);
			const updateIndex = job.indexOf('command: up');
			const verifyIndex = job.indexOf(`run: ${verifier}`);
			expect(countOccurrences(job, driftCheck)).toBe(1);
			expect(driftCheckIndex).toBeGreaterThan(-1);
			expect(driftCheckIndex).toBeLessThan(updateIndex);
			expect(updateIndex).toBeLessThan(verifyIndex);
			expect(countOccurrences(job, "pulumi-version: '3.258.0'")).toBe(2);
			expect(countOccurrences(job, 'work-dir: packages/infrastructure')).toBe(1);
			expect(
				countOccurrences(
					job,
					'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_INFRA_API_TOKEN }}'
				)
			).toBe(2);
			expect(job).toContain('organization: ${{ vars.PULUMI_ORG }}');
			expect(job).toContain(
				'requested-token-type: urn:pulumi:token-type:access_token:personal'
			);
			expect(job).toContain('scope: user:cwchanap');
		}

		expect(preProdJob).toContain('packages/infrastructure/scripts/verify-access.sh pre-prod');
		expect(productionJob).toContain(
			'packages/infrastructure/scripts/verify-access.sh production'
		);

		for (const forbidden of [
			'PULUMI_ACCESS_TOKEN',
			'PULUMI_CONFIG_PASSPHRASE',
			'command: preview',
			'DTX_ACCESS_EMAIL',
			'DTX_DEVICE_POSTURE_RULE_ID',
			'config-map',
			'reviewers:',
			'pulumi destroy',
			'pulumi up --refresh',
			'refresh: true'
		]) {
			expect(text).not.toContain(forbidden);
		}
	});
});
