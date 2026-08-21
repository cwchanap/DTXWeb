import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from 'better-auth/crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORTED_IDENTITY_PROVIDERS = new Set(['email', 'google']);

export type SupabaseIdentityExport = {
	provider?: unknown;
	identity_id?: unknown;
	id?: unknown;
	user_id?: unknown;
	identity_data?: unknown;
	created_at?: unknown;
	updated_at?: unknown;
};

export type SupabaseUserExport = {
	id?: unknown;
	email?: unknown;
	name?: unknown;
	image?: unknown;
	user_metadata?: unknown;
	email_confirmed_at?: unknown;
	confirmed_at?: unknown;
	email_verified?: unknown;
	created_at?: unknown;
	updated_at?: unknown;
	identities?: unknown;
};

export type SupabaseAuthExport = {
	users: SupabaseUserExport[];
	applicationOwnerIds?: string[];
};

export type AuthMigrationOptions = {
	replacementPasswords?: Record<string, string>;
	applicationOwnerIds?: readonly string[];
};

type AuthUserRow = {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	createdAt: number;
	updatedAt: number;
};

type AuthAccountRow = {
	id: string;
	accountId: string;
	providerId: 'credential' | 'google';
	userId: string;
	password: string | null;
	createdAt: number;
	updatedAt: number;
};

type NormalizedExport = {
	users: SupabaseUserExport[];
	applicationOwnerIds?: string[];
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
};

const asNonEmptyString = (value: unknown, label: string): string => {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
};

const asOptionalString = (value: unknown, label: string): string | null => {
	if (value === undefined || value === null) return null;
	return asNonEmptyString(value, label);
};

const parseTimestamp = (value: unknown, label: string): number => {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${label} must be an ISO timestamp or millisecond number`);
	}
	const timestamp = Date.parse(value);
	if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
		throw new Error(`${label} is not a valid timestamp`);
	}
	return timestamp;
};

const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const sqlValue = (value: string | number | boolean | null): string => {
	if (value === null) return 'NULL';
	if (typeof value === 'string') return sqlString(value);
	if (typeof value === 'boolean') return value ? '1' : '0';
	return String(value);
};

const accountPrimaryKey = (providerId: string, accountId: string): string =>
	`account-${providerId}-${accountId}`;

const identityAccountId = (identity: Record<string, unknown>, userId: string): string => {
	const identityData =
		identity.identity_data && typeof identity.identity_data === 'object'
			? (identity.identity_data as Record<string, unknown>)
			: {};
	const accountId = identityData.sub ?? identity.identity_id ?? identity.id;
	if (typeof accountId !== 'string' || accountId.length === 0) {
		throw new Error(
			`Google identity for user ${userId} is missing a stable provider account ID`
		);
	}
	return accountId;
};

const normalizeExport = (input: unknown): NormalizedExport => {
	if (Array.isArray(input)) return { users: input as SupabaseUserExport[] };
	const root = asRecord(input, 'Supabase auth export');
	const users = root.users ?? root.data;
	if (!Array.isArray(users)) {
		throw new Error('Supabase auth export must contain a users array');
	}
	const ownerIds = root.applicationOwnerIds ?? root.application_owner_ids ?? root.ownerIds;
	if (ownerIds === undefined) return { users: users as SupabaseUserExport[] };
	if (!Array.isArray(ownerIds)) throw new Error('applicationOwnerIds must be an array');
	return { users: users as SupabaseUserExport[], applicationOwnerIds: ownerIds as string[] };
};

const normalizeUser = (
	input: SupabaseUserExport,
	index: number
): AuthUserRow & { source: SupabaseUserExport } => {
	const user = asRecord(input, `Supabase user ${index + 1}`);
	const id = asNonEmptyString(user.id, `Supabase user ${index + 1} id`);
	if (!UUID_RE.test(id)) throw new Error(`Supabase user ${index + 1} id is not a UUID: ${id}`);
	const email = asNonEmptyString(user.email, `Supabase user ${id} email`);
	if (!EMAIL_RE.test(email)) throw new Error(`Supabase user ${id} email is invalid`);

	const metadata =
		user.user_metadata && typeof user.user_metadata === 'object'
			? (user.user_metadata as Record<string, unknown>)
			: {};
	const name =
		asOptionalString(
			metadata.full_name ?? metadata.name ?? user.name,
			`Supabase user ${id} name`
		) ?? email;
	const image = asOptionalString(
		metadata.avatar_url ?? metadata.picture ?? user.image,
		`Supabase user ${id} image`
	);
	const createdAt = parseTimestamp(user.created_at, `Supabase user ${id} created_at`);
	const updatedAt = parseTimestamp(user.updated_at, `Supabase user ${id} updated_at`);
	const emailVerified =
		user.email_verified === true ||
		user.email_confirmed_at != null ||
		user.confirmed_at != null;

	return {
		id,
		email,
		name,
		image,
		emailVerified,
		createdAt,
		updatedAt,
		source: input
	};
};

const normalizeOwnerIds = (ownerIds: readonly string[] | undefined): string[] => {
	if (ownerIds === undefined) return [];
	const unique = new Set<string>();
	for (const ownerId of ownerIds) {
		if (typeof ownerId !== 'string' || !UUID_RE.test(ownerId)) {
			throw new Error(`Application owner ID is not a UUID: ${String(ownerId)}`);
		}
		unique.add(ownerId);
	}
	return [...unique].sort();
};

const validateReplacementPasswords = (
	replacementPasswords: Record<string, string> | undefined,
	userIds: ReadonlySet<string>
): void => {
	if (!replacementPasswords) return;
	for (const [userId, password] of Object.entries(replacementPasswords)) {
		if (!userIds.has(userId)) {
			throw new Error(`Replacement password references unknown user ${userId}`);
		}
		if (typeof password !== 'string' || password.length === 0) {
			throw new Error(`Replacement password for user ${userId} must be non-empty`);
		}
	}
};

const createRows = async (
	input: unknown,
	options: AuthMigrationOptions
): Promise<{ users: AuthUserRow[]; accounts: AuthAccountRow[]; ownerIds: string[] }> => {
	const exported = normalizeExport(input);
	const ownerIds = normalizeOwnerIds(options.applicationOwnerIds ?? exported.applicationOwnerIds);
	const users = exported.users.map(normalizeUser);
	const userIds = new Set<string>();
	const emails = new Set<string>();
	for (const user of users) {
		if (userIds.has(user.id)) throw new Error(`Duplicate user ID: ${user.id}`);
		userIds.add(user.id);
		const emailKey = user.email.toLowerCase();
		if (emails.has(emailKey)) throw new Error(`Duplicate email: ${user.email}`);
		emails.add(emailKey);
	}
	for (const ownerId of ownerIds) {
		if (!userIds.has(ownerId)) {
			throw new Error(`Owner ID ${ownerId} is not imported`);
		}
	}
	validateReplacementPasswords(options.replacementPasswords, userIds);

	const accounts: AuthAccountRow[] = [];
	const accountIds = new Set<string>();
	const addAccount = (account: AuthAccountRow): void => {
		if (accountIds.has(account.id)) throw new Error(`Duplicate account ID: ${account.id}`);
		accountIds.add(account.id);
		accounts.push(account);
	};

	for (const user of users) {
		const source = asRecord(user.source, `Supabase user ${user.id}`);
		const identities = source.identities ?? [];
		if (!Array.isArray(identities))
			throw new Error(`Supabase user ${user.id} identities must be an array`);
		const providerAccountIds = new Set<string>();
		for (const identityValue of identities) {
			const identity = asRecord(identityValue, `Supabase identity for user ${user.id}`);
			const provider = asNonEmptyString(
				identity.provider,
				`Supabase identity for user ${user.id} provider`
			);
			if (!SUPPORTED_IDENTITY_PROVIDERS.has(provider)) {
				throw new Error(`Unsupported identity provider ${provider} for user ${user.id}`);
			}
			if (identity.user_id !== undefined && identity.user_id !== user.id) {
				throw new Error(`Identity user ID mismatch for user ${user.id}`);
			}
			if (provider !== 'google') continue;
			const providerAccountId = identityAccountId(identity, user.id);
			if (providerAccountIds.has(providerAccountId)) {
				throw new Error(
					`Duplicate google identity ${providerAccountId} for user ${user.id}`
				);
			}
			providerAccountIds.add(providerAccountId);
			const createdAt =
				identity.created_at === undefined
					? user.createdAt
					: parseTimestamp(
							identity.created_at,
							`Google identity ${providerAccountId} created_at`
						);
			const updatedAt =
				identity.updated_at === undefined
					? user.updatedAt
					: parseTimestamp(
							identity.updated_at,
							`Google identity ${providerAccountId} updated_at`
						);
			addAccount({
				id: accountPrimaryKey('google', providerAccountId),
				accountId: providerAccountId,
				providerId: 'google',
				userId: user.id,
				password: null,
				createdAt,
				updatedAt
			});
		}

		const replacementPassword = options.replacementPasswords?.[user.id];
		if (replacementPassword !== undefined) {
			addAccount({
				id: accountPrimaryKey('credential', user.id),
				accountId: user.id,
				providerId: 'credential',
				userId: user.id,
				password: await hashPassword(replacementPassword),
				createdAt: user.createdAt,
				updatedAt: user.updatedAt
			});
		}
	}

	return {
		users: users.sort((a, b) => a.id.localeCompare(b.id)),
		accounts: accounts.sort((a, b) => a.id.localeCompare(b.id)),
		ownerIds
	};
};

export const generateAuthMigrationSql = async (
	input: unknown,
	options: AuthMigrationOptions = {}
): Promise<string> => {
	const { users, accounts, ownerIds } = await createRows(input, options);
	const statements = [
		...users.map(
			(user) =>
				`INSERT INTO "user" ("id", "name", "email", "email_verified", "image", "created_at", "updated_at") VALUES (${sqlValue(user.id)}, ${sqlValue(user.name)}, ${sqlValue(user.email)}, ${sqlValue(user.emailVerified)}, ${sqlValue(user.image)}, ${sqlValue(user.createdAt)}, ${sqlValue(user.updatedAt)});`
		),
		...accounts.map(
			(account) =>
				`INSERT INTO "account" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at") VALUES (${sqlValue(account.id)}, ${sqlValue(account.accountId)}, ${sqlValue(account.providerId)}, ${sqlValue(account.userId)}, ${sqlValue(account.password)}, ${sqlValue(account.createdAt)}, ${sqlValue(account.updatedAt)});`
		)
	];
	return [
		'-- Reviewed Better Auth identity import; only user and account rows are emitted.',
		`-- Reconciled application owner IDs: ${ownerIds.length}`,
		...statements
	].join('\n');
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const reviewedSqlDir = resolve(repoRoot, 'tmp/auth-migration');

const parseArgs = (
	args: string[]
): { inputPath: string; outputPath: string; passwordsPath?: string; ownersPath: string } => {
	let inputPath: string | undefined;
	let outputPath = resolve(reviewedSqlDir, 'better-auth-import.sql');
	let passwordsPath: string | undefined;
	let ownersPath: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--output') outputPath = resolve(args[++index] ?? '');
		else if (arg === '--replacement-passwords') passwordsPath = resolve(args[++index] ?? '');
		else if (arg === '--owner-ids') ownersPath = resolve(args[++index] ?? '');
		else if (!arg.startsWith('-') && inputPath === undefined) inputPath = resolve(arg);
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!inputPath || !ownersPath)
		throw new Error(
			'Usage: migrate-supabase-auth.ts <export.json> --owner-ids <path> [--output path] [--replacement-passwords path]'
		);
	const outputRelative = relative(reviewedSqlDir, outputPath);
	if (outputRelative.startsWith('..') || isAbsolute(outputRelative)) {
		throw new Error(`Output must be under ${reviewedSqlDir}`);
	}
	return { inputPath, outputPath, passwordsPath, ownersPath };
};

const parseJsonFile = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const runCli = async (args: string[]): Promise<void> => {
	const { inputPath, outputPath, passwordsPath, ownersPath } = parseArgs(args);
	const input = parseJsonFile(inputPath);
	const replacementPasswords = passwordsPath
		? (parseJsonFile(passwordsPath) as Record<string, string>)
		: undefined;
	const ownerIds = parseJsonFile(ownersPath);
	if (!Array.isArray(ownerIds)) {
		throw new Error('Owner ID file must contain a JSON array of UUIDs');
	}
	const sql = await generateAuthMigrationSql(input, {
		replacementPasswords,
		applicationOwnerIds: ownerIds
	});
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${sql}\n`, 'utf8');
	console.log(`Wrote reviewed Better Auth SQL to ${outputPath}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await runCli(process.argv.slice(2));
}
