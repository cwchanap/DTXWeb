import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('committed Pulumi stack settings', () => {
	it.each(['Pulumi.pre-prod.yaml', 'Pulumi.production.yaml'])(
		'%s preserves the stack settings contract',
		(file) => {
			const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

			expect(text).toContain('secretsprovider: default');
			expect(text).toMatch(/dtxweb-infrastructure:accessEmail:\s*\n\s+secure:/);
			expect(text).toMatch(/dtxweb-infrastructure:devicePostureRuleId:/);
			expect(text).toContain('dtxweb-infrastructure:cloudflareAccountId:');
			expect(text).not.toContain('encryptionsalt:');
		}
	);
});
