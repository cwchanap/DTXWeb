import { generateAuthMigrationSql } from 'dtx-api/auth-migration';
import { TEST_USER_EMAIL, TEST_USER_ID, TEST_USER_PASSWORD } from '../test-config';

/**
 * Build the same Better Auth rows that the local web stack uses for login.
 * The SQL is executed by prepare-stack against its already-migrated local D1;
 * this module never opens a database connection itself.
 */
export const createBetterAuthSeedSql = async (): Promise<string> =>
	generateAuthMigrationSql(
		{
			users: [
				{
					id: TEST_USER_ID,
					email: TEST_USER_EMAIL,
					name: 'E2E Test User',
					email_confirmed_at: '2025-01-01T00:00:00.000Z',
					created_at: '2025-01-01T00:00:00.000Z',
					updated_at: '2025-01-01T00:00:00.000Z',
					identities: [
						{
							provider: 'email',
							identity_id: TEST_USER_ID,
							identity_data: { email: TEST_USER_EMAIL }
						}
					]
				}
			]
		},
		{
			replacementPasswords: { [TEST_USER_ID]: TEST_USER_PASSWORD },
			applicationOwnerIds: [TEST_USER_ID]
		}
	);
