import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyPassword } from 'better-auth/crypto';
import { describe, expect, test, vi } from 'vitest';
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
		const sql = await generateAuthMigrationSql(fixture, {
			applicationOwnerIds: fixture.applicationOwnerIds
		});

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

		const first = await generateAuthMigrationSql(fixture, {
			applicationOwnerIds: fixture.applicationOwnerIds
		});
		const second = await generateAuthMigrationSql(fixture, {
			applicationOwnerIds: fixture.applicationOwnerIds
		});
		expect(first).toBe(second);
		expect(firstAccountRow(first, 'google')).toContain(
			"'account-google-google-fixture-sub-001'"
		);
	});

	test('creates a credential account only for an explicit replacement password', async () => {
		const withoutReplacement = await generateAuthMigrationSql(fixture, {
			applicationOwnerIds: fixture.applicationOwnerIds
		});
		expect(withoutReplacement).not.toContain("'credential'");

		const withReplacement = await generateAuthMigrationSql(fixture, {
			replacementPasswords: {
				'00000000-0000-0000-0000-000000000002': 'fixture-replacement-password'
			},
			applicationOwnerIds: fixture.applicationOwnerIds
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
			generateAuthMigrationSql(
				{
					...fixture,
					users: [...fixture.users, fixture.users[0]]
				},
				{ applicationOwnerIds: [] }
			)
		).rejects.toThrow(/duplicate user id/i);

		await expect(
			generateAuthMigrationSql(
				{
					...fixture,
					users: [
						fixture.users[0],
						{ ...fixture.users[1], email: fixture.users[0].email }
					]
				},
				{ applicationOwnerIds: [] }
			)
		).rejects.toThrow(/duplicate email/i);
	});

	test('rejects unsupported providers and owner IDs with no imported user', async () => {
		await expect(
			generateAuthMigrationSql(
				{
					...fixture,
					users: [
						{
							...fixture.users[0],
							identities: [{ provider: 'github', identity_id: 'github-fixture' }]
						}
					]
				},
				{ applicationOwnerIds: [fixture.users[0].id] }
			)
		).rejects.toThrow(/unsupported identity provider.*github/i);

		await expect(
			generateAuthMigrationSql(
				{ ...fixture },
				{
					applicationOwnerIds: [
						...fixture.applicationOwnerIds,
						'00000000-0000-0000-0000-000000000099'
					]
				}
			)
		).rejects.toThrow(/owner id.*00000000-0000-0000-0000-000000000099.*not imported/i);
	});

	test('rejects a replacement password for an unknown user', async () => {
		await expect(
			generateAuthMigrationSql(fixture, {
				replacementPasswords: {
					'00000000-0000-0000-0000-000000000099': 'fixture-password'
				},
				applicationOwnerIds: fixture.applicationOwnerIds
			})
		).rejects.toThrow(/replacement password.*unknown user/i);
	});

	test('rejects an exported user that is not an object', async () => {
		await expect(
			generateAuthMigrationSql({ users: ['not-an-object'] }, { applicationOwnerIds: [] })
		).rejects.toThrow(/Supabase user 1 must be an object/i);
	});

	test('rejects a user with no email', async () => {
		const user = { ...fixture.users[0] };
		delete user.email;

		await expect(
			generateAuthMigrationSql({ ...fixture, users: [user] }, { applicationOwnerIds: [] })
		).rejects.toThrow(/email must be a non-empty string/i);
	});

	test('rejects a user with a non-string creation timestamp', async () => {
		await expect(
			generateAuthMigrationSql(
				{
					...fixture,
					users: [{ ...fixture.users[0], created_at: true }],
					applicationOwnerIds: []
				},
				{ applicationOwnerIds: [] }
			)
		).rejects.toThrow(/created_at must be an ISO timestamp or millisecond number/i);
	});

	test('rejects a user with an invalid creation timestamp', async () => {
		await expect(
			generateAuthMigrationSql(
				{
					...fixture,
					users: [{ ...fixture.users[0], created_at: 'garbage' }],
					applicationOwnerIds: []
				},
				{ applicationOwnerIds: [] }
			)
		).rejects.toThrow(/created_at is not a valid timestamp/i);
	});

	test('accepts data exports and snake-case application owner IDs', async () => {
		const sql = await generateAuthMigrationSql(
			{
				data: [fixture.users[0]],
				application_owner_ids: [fixture.users[0].id]
			},
			{ applicationOwnerIds: [fixture.users[0].id] }
		);

		expect(sql).toContain('-- Reconciled application owner IDs: 1');
	});

	test('rejects an export without a users array', async () => {
		await expect(
			generateAuthMigrationSql({ users: 'nope' }, { applicationOwnerIds: [] })
		).rejects.toThrow(/Supabase auth export must contain a users array/i);
	});

	test('rejects non-array application owner IDs', async () => {
		await expect(
			generateAuthMigrationSql(
				{ users: [], applicationOwnerIds: 'x' },
				{
					applicationOwnerIds: []
				}
			)
		).rejects.toThrow(/applicationOwnerIds must be an array/i);
	});

	test('requires explicit application owner IDs even when the export embeds them', async () => {
		// Owner intent must be supplied by the caller; inheriting it from the
		// export file would let a tampered export silently grant ownership.
		await expect(generateAuthMigrationSql(fixture, {} as never)).rejects.toThrow(
			/options\.applicationOwnerIds is required/i
		);

		await expect(
			generateAuthMigrationSql(fixture, { applicationOwnerIds: undefined as never })
		).rejects.toThrow(/options\.applicationOwnerIds is required/i);
	});

	test('uses the top-level name when user metadata is not an object', async () => {
		const sql = await generateAuthMigrationSql(
			{
				users: [
					{
						...fixture.users[0],
						name: 'Top-level Fixture Name',
						user_metadata: 'x',
						identities: []
					}
				],
				applicationOwnerIds: []
			},
			{ applicationOwnerIds: [] }
		);

		expect(sql).toContain("'Top-level Fixture Name'");
	});

	test('uses identity_id when a Google identity has no identity data', async () => {
		const sql = await generateAuthMigrationSql(
			{
				...fixture,
				users: [
					{
						...fixture.users[0],
						identities: [{ provider: 'google', identity_id: 'google-fallback-id' }]
					}
				],
				applicationOwnerIds: []
			},
			{ applicationOwnerIds: [] }
		);

		expect(firstAccountRow(sql, 'google')).toContain("'account-google-google-fallback-id'");
	});

	test('rejects a Google identity without a stable provider account ID', async () => {
		await expect(
			generateAuthMigrationSql(
				{
					...fixture,
					users: [{ ...fixture.users[0], identities: [{ provider: 'google' }] }],
					applicationOwnerIds: []
				},
				{ applicationOwnerIds: [] }
			)
		).rejects.toThrow(/missing a stable provider account ID/i);
	});

	test('rejects an owner ID that is not a UUID', async () => {
		await expect(
			generateAuthMigrationSql(fixture, { applicationOwnerIds: ['not-a-uuid'] })
		).rejects.toThrow(/Application owner ID is not a UUID/i);
	});

	test('rejects an empty replacement password', async () => {
		await expect(
			generateAuthMigrationSql(fixture, {
				replacementPasswords: { [fixture.users[0].id]: '' },
				applicationOwnerIds: fixture.applicationOwnerIds
			})
		).rejects.toThrow(/must be non-empty/i);
	});

	test('rejects an identity belonging to another user', async () => {
		await expect(
			generateAuthMigrationSql(
				{
					...fixture,
					users: [
						{
							...fixture.users[0],
							identities: [
								{
									provider: 'google',
									identity_id: 'google-mismatch-id',
									user_id: 'other-user'
								}
							]
						}
					],
					applicationOwnerIds: []
				},
				{ applicationOwnerIds: [] }
			)
		).rejects.toThrow(/Identity user ID mismatch/i);
	});

	test('rejects duplicate Google identities for a user', async () => {
		await expect(
			generateAuthMigrationSql(
				{
					...fixture,
					users: [
						{
							...fixture.users[0],
							identities: [
								{ provider: 'google', identity_id: 'duplicate-google-id' },
								{ provider: 'google', identity_id: 'duplicate-google-id' }
							]
						}
					],
					applicationOwnerIds: []
				},
				{ applicationOwnerIds: [] }
			)
		).rejects.toThrow(/Duplicate google identity/i);
	});

	test('uses numeric user timestamps for identities without timestamps', async () => {
		const sql = await generateAuthMigrationSql(
			{
				...fixture,
				users: [
					{
						...fixture.users[0],
						created_at: 1234567890,
						updated_at: 1234567891,
						identities: [{ provider: 'google', identity_id: 'google-timestamp-id' }]
					}
				],
				applicationOwnerIds: []
			},
			{ applicationOwnerIds: [] }
		);
		const accountRow = firstAccountRow(sql, 'google');

		expect(accountRow).toContain('1234567890');
		expect(accountRow).toContain('1234567891');
	});

	test('runs the CLI in-process and writes reviewed SQL', async () => {
		const inputDir = mkdtempSync(join(tmpdir(), 'better-auth-cli-happy-'));
		const inputPath = join(inputDir, 'export.json');
		const ownersPath = join(inputDir, 'owners.json');
		const passwordsPath = join(inputDir, 'passwords.json');
		const outputPath = resolve(
			import.meta.dirname,
			'../../../..',
			'tmp/auth-migration',
			`cli-happy-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`
		);
		writeFileSync(inputPath, JSON.stringify(fixture));
		writeFileSync(ownersPath, JSON.stringify(fixture.applicationOwnerIds));
		writeFileSync(
			passwordsPath,
			JSON.stringify({ [fixture.users[1].id]: 'cli-replacement-password' })
		);

		try {
			const modulePath = resolve(import.meta.dirname, 'migrate-supabase-auth.ts');
			const originalArgv = process.argv;
			try {
				process.argv = [
					process.execPath,
					modulePath,
					inputPath,
					'--owner-ids',
					ownersPath,
					'--replacement-passwords',
					passwordsPath,
					'--output',
					outputPath
				];
				vi.resetModules();
				await import('./migrate-supabase-auth');
			} finally {
				process.argv = originalArgv;
			}

			expect(existsSync(outputPath)).toBe(true);
			const sql = readFileSync(outputPath, 'utf8');
			expect(sql).toContain('INSERT INTO "user"');
			expect(sql).toContain("'credential'");
		} finally {
			rmSync(inputDir, { recursive: true, force: true });
			rmSync(outputPath, { force: true });
		}
	});

	test('rejects an unknown in-process CLI argument', async () => {
		const inputDir = mkdtempSync(join(tmpdir(), 'better-auth-cli-unknown-'));
		const inputPath = join(inputDir, 'export.json');
		writeFileSync(inputPath, JSON.stringify(fixture));

		try {
			const modulePath = resolve(import.meta.dirname, 'migrate-supabase-auth.ts');
			const originalArgv = process.argv;
			try {
				process.argv = [process.execPath, modulePath, inputPath, '--bogus'];
				vi.resetModules();
				await expect(import('./migrate-supabase-auth')).rejects.toThrow(
					/Unknown argument/i
				);
			} finally {
				process.argv = originalArgv;
			}
		} finally {
			rmSync(inputDir, { recursive: true, force: true });
		}
	});

	test('rejects an in-process CLI invocation without owner IDs', async () => {
		const inputDir = mkdtempSync(join(tmpdir(), 'better-auth-cli-owners-'));
		const inputPath = join(inputDir, 'export.json');
		writeFileSync(inputPath, JSON.stringify(fixture));

		try {
			const modulePath = resolve(import.meta.dirname, 'migrate-supabase-auth.ts');
			const originalArgv = process.argv;
			try {
				process.argv = [process.execPath, modulePath, inputPath];
				vi.resetModules();
				await expect(import('./migrate-supabase-auth')).rejects.toThrow(/Usage:/i);
			} finally {
				process.argv = originalArgv;
			}
		} finally {
			rmSync(inputDir, { recursive: true, force: true });
		}
	});

	test('rejects an in-process CLI output outside the reviewed directory', async () => {
		const inputDir = mkdtempSync(join(tmpdir(), 'better-auth-cli-output-'));
		const inputPath = join(inputDir, 'export.json');
		const ownersPath = join(inputDir, 'owners.json');
		const outputPath = join(inputDir, 'outside.sql');
		writeFileSync(inputPath, JSON.stringify(fixture));
		writeFileSync(ownersPath, JSON.stringify(fixture.applicationOwnerIds));

		try {
			const modulePath = resolve(import.meta.dirname, 'migrate-supabase-auth.ts');
			const originalArgv = process.argv;
			try {
				process.argv = [
					process.execPath,
					modulePath,
					inputPath,
					'--owner-ids',
					ownersPath,
					'--output',
					outputPath
				];
				vi.resetModules();
				await expect(import('./migrate-supabase-auth')).rejects.toThrow(
					/Output must be under/i
				);
			} finally {
				process.argv = originalArgv;
			}
		} finally {
			rmSync(inputDir, { recursive: true, force: true });
		}
	});

	test('rejects a non-array owner ID file from the CLI', async () => {
		const inputDir = mkdtempSync(join(tmpdir(), 'better-auth-cli-owner-file-'));
		const inputPath = join(inputDir, 'export.json');
		const ownersPath = join(inputDir, 'owners.json');
		writeFileSync(inputPath, JSON.stringify(fixture));
		writeFileSync(ownersPath, JSON.stringify({ owner: fixture.users[0].id }));

		try {
			const modulePath = resolve(import.meta.dirname, 'migrate-supabase-auth.ts');
			const originalArgv = process.argv;
			try {
				process.argv = [process.execPath, modulePath, inputPath, '--owner-ids', ownersPath];
				vi.resetModules();
				await expect(import('./migrate-supabase-auth')).rejects.toThrow(
					/Owner ID file must contain a JSON array/i
				);
			} finally {
				process.argv = originalArgv;
			}
		} finally {
			rmSync(inputDir, { recursive: true, force: true });
		}
	});
});
