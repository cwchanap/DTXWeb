// e2e/setup/prepare-stack.ts
// Migrate + seed the local Miniflare backend for the current leg, BEFORE the
// dev server starts. Run by the Playwright webServer command.
//
// Leg selection: E2E_USE_GRAPHQL === 'true' → seed dtx-api; else → seed dtx-web.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TEST_USER_ID, CHART_B_ID } from '../test-config';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..', '..');

const useGraphQL = process.env.E2E_USE_GRAPHQL === 'true';
const pkg = useGraphQL ? 'dtx-api' : 'dtx-web';
const pkgDir = join(repoRoot, 'packages', pkg);
const persist = '.wrangler/state';
const absPersist = join(pkgDir, persist);
const migration = join(repoRoot, 'packages/dtx-web/d1-migrations/0001_initial_schema.sql');
const fixture = join(repoRoot, 'e2e/fixtures/test-sample.dtx');

// The D1 database NAME is "dtx-web" in BOTH packages' wrangler.jsonc (dtx-web and
// dtx-api share database_name "dtx-web"), so it is correct regardless of the leg's
// pkgDir. The local Miniflare sqlite resolved by `wrangler d1 execute <name> --local`
// is the same one the worker binds as DB in that package.
const D1_NAME = 'dtx-web';

const wrangler = (args: string[]): void => {
	execFileSync('bunx', ['wrangler', ...args], { cwd: pkgDir, stdio: 'inherit' });
};

// 1. Fresh state, then apply schema (migration CREATE INDEX lacks IF NOT EXISTS,
//    so we wipe + re-migrate for a deterministic seed).
rmSync(absPersist, { recursive: true, force: true });
wrangler(['d1', 'execute', D1_NAME, '--local', '--persist-to', persist, '--file', migration]);

// 2. Seed rows (idempotent: the seed deletes ids 1001/1002 first).
const seedSql = readFileSync(join(here, 'seed.sql'), 'utf8').replaceAll(
	'__TEST_USER_ID__',
	TEST_USER_ID
);
const tmpSeedDir = mkdtempSync(join(tmpdir(), 'e2e-seed-'));
const tmpSeed = join(tmpSeedDir, 'seed.sql');
writeFileSync(tmpSeed, seedSql);
wrangler(['d1', 'execute', D1_NAME, '--local', '--persist-to', persist, '--file', tmpSeed]);
rmSync(tmpSeedDir, { recursive: true, force: true });

// 3. Put the R2 object so chart B reports has_uploaded_files=true and download has content.
wrangler([
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
