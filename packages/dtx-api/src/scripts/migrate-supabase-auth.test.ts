import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyPassword } from 'better-auth/crypto';
import { describe, expect, test } from 'vitest';
import { generateAuthMigrationSql } from './migrate-supabase-auth';

const fixture = JSON.parse(
	readFileSync(resolve(import.meta.dirname, 'fixtures/supabase-auth-export.json'), 'utf8')
);

const firstAccountRow = (sql: string, provider: string): string => {
	const row = sql.split('\n').find((line) => line.includes(`'${provider}'`));
	if (!row) throw new Error(`No ${provider} account row found`);
	return row;
};

describe('Supabase auth export migration', () => {
	test('CLI requires owner IDs before writing reviewed SQL', () => {
		const inputDir = mkdtempSync(join(tmpdir(), 'better-auth-cli-omission-'));
		const inputPath = join(inputDir, 'export.json');
		const outputPath = join(
			resolve(import.meta.dirname, '../../../..', 'tmp/auth-migration'),
			`cli-omission-${process.pid}-${Date.now()}.sql`
		);
		const supabaseExportWithoutOwners = { ...fixture };
		delete supabaseExportWithoutOwners.applicationOwnerIds;
		writeFileSync(inputPath, JSON.stringify(supabaseExportWithoutOwners));

		try {
			const result = spawnSync(
				process.execPath,
				[
					resolve(import.meta.dirname, 'migrate-supabase-auth.ts'),
					inputPath,
					'--output',
					outputPath
				],
				{ encoding: 'utf8' }
			);

			expect(result.status).not.toBe(0);
			expect(`${result.stdout}\n${result.stderr}`).toMatch(/--owner-ids/);
			expect(existsSync(outputPath)).toBe(false);
		} finally {
			rmSync(inputDir, { recursive: true, force: true });
			rmSync(outputPath, { force: true });
		}
	});

	test('preserves user identity, Google identity, timestamps, and omits sessions and tokens', async () => {
		const sql = await generateAuthMigrationSql(fixture);

		expect(sql).toContain("'00000000-0000-0000-0000-000000000001'");
		expect(sql).toContain("'o''hara@example.test'");
		expect(sql).toContain("'O''Hara Fixture'");
		expect(sql).toContain("'google-fixture-sub-001'");
		expect(sql).toContain(String(Date.parse('2025-01-01T03:04:05.000Z')));
		expect(sql).toContain(String(Date.parse('2025-01-03T03:04:05.000Z')));
		expect(sql).toMatch(/email_verified.*\)\s+VALUES[^(]*\([^,]+,[^,]+,[^,]+,\s*1,/s);
		expect(sql).toMatch(/INSERT INTO "account"/);
		expect(sql).not.toContain('BEGIN TRANSACTION;');
		expect(sql).not.toContain('COMMIT;');
		expect(sql).not.toMatch(/INSERT INTO "(?:session|verification)"/i);
		expect(sql).not.toMatch(
			/(?:access_token|refresh_token|id_token|session_token|password_hash)/i
		);

		const first = await generateAuthMigrationSql(fixture);
		const second = await generateAuthMigrationSql(fixture);
		expect(first).toBe(second);
		expect(firstAccountRow(first, 'google')).toContain(
			"'account-google-google-fixture-sub-001'"
		);
	});

	test('creates a credential account only for an explicit replacement password', async () => {
		const withoutReplacement = await generateAuthMigrationSql(fixture);
		expect(withoutReplacement).not.toContain("'credential'");

		const withReplacement = await generateAuthMigrationSql(fixture, {
			replacementPasswords: {
				'00000000-0000-0000-0000-000000000002': 'fixture-replacement-password'
			}
		});
		const row = firstAccountRow(withReplacement, 'credential');
		const hash = row.match(
			/'credential',\s*'00000000-0000-0000-0000-000000000002',\s*'([^']+)'/
		)?.[1];
		if (!hash) throw new Error('Credential account password hash was not emitted');
		expect(await verifyPassword({ hash, password: 'fixture-replacement-password' })).toBe(true);
		expect(await verifyPassword({ hash, password: 'wrong-password' })).toBe(false);
	});

	test('rejects duplicate users and duplicate emails before emitting SQL', async () => {
		await expect(
			generateAuthMigrationSql({
				...fixture,
				users: [...fixture.users, fixture.users[0]]
			})
		).rejects.toThrow(/duplicate user id/i);

		await expect(
			generateAuthMigrationSql({
				...fixture,
				users: [fixture.users[0], { ...fixture.users[1], email: fixture.users[0].email }]
			})
		).rejects.toThrow(/duplicate email/i);
	});

	test('rejects unsupported providers and owner IDs with no imported user', async () => {
		await expect(
			generateAuthMigrationSql({
				...fixture,
				applicationOwnerIds: [fixture.users[0].id],
				users: [
					{
						...fixture.users[0],
						identities: [{ provider: 'github', identity_id: 'github-fixture' }]
					}
				]
			})
		).rejects.toThrow(/unsupported identity provider.*github/i);

		await expect(
			generateAuthMigrationSql({
				...fixture,
				applicationOwnerIds: [
					...fixture.applicationOwnerIds,
					'00000000-0000-0000-0000-000000000099'
				]
			})
		).rejects.toThrow(/owner id.*00000000-0000-0000-0000-000000000099.*not imported/i);
	});

	test('rejects a replacement password for an unknown user', async () => {
		await expect(
			generateAuthMigrationSql(fixture, {
				replacementPasswords: {
					'00000000-0000-0000-0000-000000000099': 'fixture-password'
				}
			})
		).rejects.toThrow(/replacement password.*unknown user/i);
	});
});
