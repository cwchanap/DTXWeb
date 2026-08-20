import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import * as authSchema from './schema';

const migrationSql = readFileSync(
	new URL('../../d1-migrations/0008_better_auth.sql', import.meta.url),
	'utf8'
);

describe('Better Auth D1 schema', () => {
	test('exports core, device authorization, and database rate-limit tables', () => {
		expect(authSchema.user).toBeDefined();
		expect(authSchema.session).toBeDefined();
		expect(authSchema.account).toBeDefined();
		expect(authSchema.verification).toBeDefined();
		expect(authSchema.deviceCode).toBeDefined();
		expect(authSchema.rateLimit).toBeDefined();

		for (const table of [
			'user',
			'session',
			'account',
			'verification',
			'device_code',
			'rate_limit'
		]) {
			expect(migrationSql).toContain(`CREATE TABLE \`${table}\``);
		}
	});

	test('keeps Better Auth user identity columns as text and preserves user foreign keys', () => {
		expect(migrationSql).toMatch(/CREATE TABLE `user`[\s\S]*?`id`\s+text/i);
		expect(migrationSql).toMatch(/`user_id`\s+text/i);
		expect(migrationSql).toMatch(
			/CREATE TABLE `session`[\s\S]*?FOREIGN KEY \(`user_id`\) REFERENCES `user`\(`id`\)/i
		);
		expect(migrationSql).toMatch(
			/CREATE TABLE `account`[\s\S]*?FOREIGN KEY \(`user_id`\) REFERENCES `user`\(`id`\)/i
		);
	});
});
