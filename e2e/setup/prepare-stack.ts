// e2e/setup/prepare-stack.ts
// Migrate + seed the local Miniflare backend (dtx-api), BEFORE the dev server
// starts. Run by the Playwright webServer command.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TEST_USER_ID, CHART_B_ID, isAuthConfigured } from '../test-config';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..', '..');

const pkg = 'dtx-api';
const pkgDir = join(repoRoot, 'packages', pkg);
const persist = '.wrangler/state';
const absPersist = join(pkgDir, persist);
const migration = join(repoRoot, 'packages/dtx-api/d1-migrations/0001_initial_schema.sql');
const seedFile = join(here, 'seed.sql');
const fixture = join(repoRoot, 'e2e/fixtures/test-sample.dtx');

// Pre-check: all required files must exist before we start, otherwise failures
// surface as opaque Playwright "webServer timed out after 180s" errors.
for (const [label, path] of [
	['D1 migration', migration],
	['seed SQL', seedFile],
	['R2 fixture (test-sample.dtx)', fixture]
] as const) {
	if (!existsSync(path)) {
		throw new Error(`[prepare-stack] missing ${label} at ${path}`);
	}
}

// The D1 database NAME is "dtx-web" in BOTH packages' wrangler.jsonc (dtx-web and
// dtx-api share database_name "dtx-web"), so it is correct regardless of the leg's
// pkgDir. The local Miniflare sqlite resolved by `wrangler d1 execute <name> --local`
// is the same one the worker binds as DB in that package.
const D1_NAME = 'dtx-web';

const wrangler = (label: string, args: string[]): void => {
	try {
		console.log(`[prepare-stack] ${label}...`);
		execFileSync('bunx', ['wrangler', ...args], { cwd: pkgDir, stdio: 'inherit' });
	} catch (err) {
		throw new Error(`[prepare-stack] ${label} failed: ${err}`);
	}
};

// When auth env vars are not configured, use a deterministic dummy UUID so
// non-auth e2e specs can still run (the webServer command always executes
// prepare-stack before Vite starts, regardless of project filters).
const DUMMY_USER_ID = '00000000-0000-0000-0000-000000000000';
const ownerId = isAuthConfigured ? TEST_USER_ID : DUMMY_USER_ID;

// Validate ownerId is a real UUID — a placeholder would create garbage rows.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(ownerId)) {
	throw new Error(
		`[prepare-stack] ownerId ("${ownerId}") is not a valid UUID. ` +
			'Set E2E_USER_ID in your environment.'
	);
}

// 1. Fresh state, then apply schema (migration CREATE INDEX lacks IF NOT EXISTS,
//    so we wipe + re-migrate for a deterministic seed).
rmSync(absPersist, { recursive: true, force: true });
wrangler('apply D1 migration', [
	'd1',
	'execute',
	D1_NAME,
	'--local',
	'--persist-to',
	persist,
	'--file',
	migration
]);

// 2. Seed rows (idempotent: the seed deletes ids 1001/1002 first).
const seedSql = readFileSync(seedFile, 'utf8').replaceAll('__TEST_USER_ID__', ownerId);
const tmpSeedDir = mkdtempSync(join(tmpdir(), 'e2e-seed-'));
const tmpSeed = join(tmpSeedDir, 'seed.sql');
try {
	writeFileSync(tmpSeed, seedSql);
	wrangler('seed D1 rows', [
		'd1',
		'execute',
		D1_NAME,
		'--local',
		'--persist-to',
		persist,
		'--file',
		tmpSeed
	]);
} finally {
	// Always clean up the temp file containing the UUID to avoid leaking on failure.
	rmSync(tmpSeedDir, { recursive: true, force: true });
}

// 3. Put the R2 object so chart B reports has_uploaded_files=true and download has content.
wrangler('put R2 object', [
	'r2',
	'object',
	'put',
	`simfile-dtx/${CHART_B_ID}/song.dtx`,
	'--local',
	'--persist-to',
	persist,
	'--file',
	fixture
]);

console.log(
	`[prepare-stack] seeded ${pkg} local Miniflare (charts 1001/1002 + R2 ${CHART_B_ID}/song.dtx)`
);
