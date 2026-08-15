# HPA-308 Score Import Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make imported score data truthful by keeping the coherent DTXManiaCX best-score stat block on the best row, moving cumulative full-combo/max-combo values to chart aggregates, and preserving unknown per-play clear results as unknown.

**Architecture:** Keep the existing `ChartScore` + `Score` model and the existing atomic replace-all upload path. `chart_scores` remains the per-user chart aggregate; `scores` remains the best/recent row store. Extend the existing chart aggregate with `fullCombo` / `maxCombo`, narrow `Score`, and carry that ownership through D1, GraphQL, desktop import/upload, the web adapter/UI, and the existing score E2E flow. Do not add a compatibility layer, a second score representation, or history reconstruction.

**Tech Stack:** Cloudflare D1 / SQLite migrations, TypeScript, Drizzle schema definitions, Pothos GraphQL, Svelte 5, Rust + rusqlite/Tauri, Vitest, Cargo tests, GraphQL Code Generator, Playwright.

## Global Constraints

- Keep `chart_scores` as the sole per-user chart aggregate and `scores` as best/recent score rows; do not add a new domain table.
- Preserve the existing atomic `upsert chart_scores -> delete scores -> insert replacement scores` D1 batch.
- Preserve exactly one best row and at most five recent rows per uploaded chart.
- Best row contains only `BestScore`, `BestAchievementRate`, derived rank, and the `BestPerfect/BestGreat/BestGood/BestPoor/BestMiss` stat block; its `cleared`, `performedAt`, and `displayOrder` are `null`.
- `fullCombo` means “this chart has ever been full-comboed” and belongs on `ChartScore`.
- `maxCombo` means the all-time maximum combo and belongs on `ChartScore`; store it as a non-negative integer with default `0`.
- Recent `cleared` is tri-state: `true`, `false`, or `null` when `HistoryLine` cannot determine the result.
- Remove `fullCombo` and `maxCombo` from the `Score` persistence/API/client shape instead of keeping aliases or deprecated fields.
- Do not version the GraphQL mutation or preserve the old upload shape; there are no compatibility requirements for this breaking change.
- Do not change chart matching, upload batching, score pagination, authentication, navigation, or history retention.
- Update the existing `packages/e2e-web/score.spec.ts` contract fixture and assertions; do not add a second E2E scenario.
- Generated GraphQL artifacts remain committed: API schema first, then web client types.

---

## Task 1: Move aggregate ownership into the D1/common contract and prove the migration

**Files:**
- Create: `packages/dtx-api/d1-migrations/0007_score_semantics.sql`
- Modify: `packages/common/src/lib/server/db/schema.ts`
- Modify: `packages/common/src/lib/types/d1.types.ts`
- Modify: `packages/common/src/lib/server/db.ts`
- Test: `packages/common/src/lib/server/db.test.ts`
- Test: `packages/common/src/lib/server/db.integration.test.ts`

**Interfaces:**
- Consumes: existing `upsertChartScoreAndReplaceScores(db, params)` atomic batch and `getUserChartScore` / `listUserChartScores` readers.
- Produces: `ChartScoreRow.full_combo: 0 | 1`, `ChartScoreRow.max_combo: number`, nullable `ScoreRow.cleared`, and `upsertChartScoreAndReplaceScores` parameters `fullCombo: boolean`, `maxCombo: number`.

- [ ] **Step 1: Add a migration regression test that starts from the real 0002 shape**

In `db.integration.test.ts`, add helpers that can apply the numbered migration chain only through a named file:

```ts
const migrationNamed = (fileName: string) => {
	const migration = MIGRATIONS.find((candidate) => candidate.fileName === fileName);
	if (!migration) throw new Error(`Missing migration: ${fileName}`);
	return migration;
};

const runMigrationsThrough = async (lastFileName: string) => {
	for (const migration of MIGRATIONS) {
		await runMigration(migration.statements);
		if (migration.fileName === lastFileName) return;
	}
	throw new Error(`Migration not reached: ${lastFileName}`);
};
```

Add one test which resets the D1 database, applies only `0001` through `0006`, seeds the old contract, applies `0007`, and verifies the backfill/rebuild:

```ts
it('0007 moves aggregate score fields and clears invented best-play metadata', async () => {
	await db.prepare('DROP TABLE IF EXISTS scores').run();
	await db.prepare('DROP TABLE IF EXISTS chart_scores').run();
	await db.prepare('DROP TABLE IF EXISTS dtx_files').run();
	await db.prepare('DROP TABLE IF EXISTS user_profiles').run();
	await db.prepare('DROP TABLE IF EXISTS simfiles').run();

	await runMigrationsThrough('0006_google_drive_file_id.sql');

	await db
		.prepare('INSERT INTO simfiles (title, artist, bpm, user_id) VALUES (?, ?, ?, ?)')
		.bind('Migration Song', 'Artist', 120, 'user-1')
		.run();
	await db
		.prepare('INSERT INTO dtx_files (label, level, simfile_id) VALUES (?, ?, ?)')
		.bind('BASIC', 50, 1)
		.run();
	await db
		.prepare(
			'INSERT INTO chart_scores (chart_id, user_id, play_count, clear_count) VALUES (?, ?, ?, ?)'
		)
		.bind(1, 'user-1', 7, 4)
		.run();
	const chartScore = await db
		.prepare('SELECT id FROM chart_scores WHERE chart_id = ? AND user_id = ?')
		.bind(1, 'user-1')
		.first<{ id: number }>();

	await db
		.prepare(
			`INSERT INTO scores
			 (chart_score_id, is_best, score, achievement_rate, rank_label,
			  full_combo, cleared, max_combo, perfect, great, good, poor, miss,
			  performed_at, display_order)
			 VALUES (?, 1, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, NULL)`
		)
		.bind(
			chartScore!.id,
			987654,
			96.25,
			'SS',
			812,
			700,
			80,
			20,
			8,
			4,
			'2026-08-14T13:00:00Z'
		)
		.run();

	await runMigration(migrationNamed('0007_score_semantics.sql').statements);

	const migratedChart = await db
		.prepare('SELECT full_combo, max_combo FROM chart_scores WHERE id = ?')
		.bind(chartScore!.id)
		.first<{ full_combo: number; max_combo: number }>();
	expect(migratedChart).toEqual({ full_combo: 1, max_combo: 812 });

	const migratedBest = await db
		.prepare(
			`SELECT cleared, performed_at, score, achievement_rate, perfect, great, good, poor, miss
			 FROM scores WHERE chart_score_id = ? AND is_best = 1`
		)
		.bind(chartScore!.id)
		.first<{
			cleared: number | null;
			performed_at: string | null;
			score: number | null;
			achievement_rate: number | null;
			perfect: number | null;
			great: number | null;
			good: number | null;
			poor: number | null;
			miss: number | null;
		}>();
	expect(migratedBest).toMatchObject({
		cleared: null,
		performed_at: null,
		score: 987654,
		achievement_rate: 96.25,
		perfect: 700,
		great: 80,
		good: 20,
		poor: 8,
		miss: 4
	});
});
```

This verifies the risky part of `0007`: real pre-0007 data, aggregate backfill, table rebuild, and best-row canonicalization. It is migration verification, not a compatibility feature.

- [ ] **Step 2: Run the migration regression and confirm it fails before `0007` exists**

```bash
bun run --filter=@dtx/common test -- db.integration.test.ts
```

Expected: FAIL because `0007_score_semantics.sql` does not yet exist / the new columns and rebuilt shape are absent.

- [ ] **Step 3: Add `0007_score_semantics.sql`**

Use the current best row only to backfill values whose source fields are already chart-wide aggregates, then rebuild `scores` without the wrongly owned columns:

```sql
ALTER TABLE chart_scores ADD COLUMN full_combo INTEGER NOT NULL DEFAULT 0 CHECK (full_combo IN (0, 1));
ALTER TABLE chart_scores ADD COLUMN max_combo INTEGER NOT NULL DEFAULT 0 CHECK (max_combo >= 0);

UPDATE chart_scores
SET full_combo = COALESCE((
        SELECT s.full_combo
        FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1
        LIMIT 1
    ), 0),
    max_combo = COALESCE((
        SELECT s.max_combo
        FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1
        LIMIT 1
    ), 0);

CREATE TABLE scores_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_score_id INTEGER NOT NULL,
    is_best INTEGER NOT NULL DEFAULT 0 CHECK (is_best IN (0, 1)),
    score INTEGER CHECK (score IS NULL OR score >= 0),
    achievement_rate REAL CHECK (
        achievement_rate IS NULL OR
        (achievement_rate >= 0 AND achievement_rate <= 100)
    ),
    rank_label TEXT CHECK (
        rank_label IS NULL OR rank_label IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F')
    ),
    cleared INTEGER CHECK (cleared IS NULL OR cleared IN (0, 1)),
    perfect INTEGER CHECK (perfect IS NULL OR perfect >= 0),
    great INTEGER CHECK (great IS NULL OR great >= 0),
    good INTEGER CHECK (good IS NULL OR good >= 0),
    poor INTEGER CHECK (poor IS NULL OR poor >= 0),
    miss INTEGER CHECK (miss IS NULL OR miss >= 0),
    performed_at TEXT,
    display_order INTEGER CHECK (
        display_order IS NULL OR (display_order >= 1 AND display_order <= 5)
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_score_id) REFERENCES chart_scores(id) ON DELETE CASCADE
);

INSERT INTO scores_v2 (
    id, chart_score_id, is_best, score, achievement_rate, rank_label,
    cleared, perfect, great, good, poor, miss, performed_at,
    display_order, created_at
)
SELECT
    id, chart_score_id, is_best, score, achievement_rate, rank_label,
    CASE WHEN is_best = 1 THEN NULL ELSE cleared END,
    perfect, great, good, poor, miss,
    CASE WHEN is_best = 1 THEN NULL ELSE performed_at END,
    display_order, created_at
FROM scores;

DROP TABLE scores;
ALTER TABLE scores_v2 RENAME TO scores;

CREATE INDEX idx_scores_chart_score ON scores(chart_score_id);
CREATE UNIQUE INDEX idx_scores_one_best
    ON scores(chart_score_id) WHERE is_best = 1;
CREATE UNIQUE INDEX idx_scores_display_order
    ON scores(chart_score_id, display_order) WHERE display_order IS NOT NULL;
```

Keep a migration comment stating that current CHECK parity spans `0002_scores.sql` plus `0007_score_semantics.sql`; do not edit `0002` to pretend the historical migration always had the new shape.

- [ ] **Step 4: Mirror the new current schema in Drizzle and shared row types**

Update `chartScores` in `schema.ts`:

```ts
fullCombo: integer('full_combo').$type<0 | 1>().notNull().default(0),
maxCombo: integer('max_combo').notNull().default(0),
```

Add chart checks:

```ts
fullComboCheck: check('chart_scores_full_combo_check', sql`${table.fullCombo} IN (0, 1)`),
maxComboCheck: check('chart_scores_max_combo_check', sql`${table.maxCombo} >= 0`),
```

Remove `fullCombo` / `maxCombo` from `scores`, and make `cleared` nullable:

```ts
cleared: integer('cleared').$type<0 | 1>(),
clearedCheck: check(
	'scores_cleared_check',
	sql`${table.cleared} IS NULL OR ${table.cleared} IN (0, 1)`
),
```

Update `d1.types.ts` so `ChartScoreRow` owns:

```ts
full_combo: 0 | 1;
max_combo: number;
```

and `ScoreRow` / `ScoreInsert` use:

```ts
cleared: 0 | 1 | null;
// ...
cleared?: boolean | null;
```

with no score-level `full_combo` or `max_combo` fields.

- [ ] **Step 5: Retarget CHECK parity to the current 0002 + 0007 contract**

In `db.test.ts`, rename the describe block to reflect the current migration chain rather than `0002` alone.

Keep `parseSchemaChecks` and the existing `propToColumn` entries. `propToColumn` already contains `fullCombo -> full_combo` and `maxCombo -> max_combo`, so do **not** add redundant mappings.

Change the migration-side parser to collect normalized CHECK expressions as a set instead of keying by the first token on the SQL line:

```ts
const parseMigrationChecks = (sql: string): Set<string> => {
	const checks = new Set<string>();
	for (const line of sql.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith('--')) continue;
		const checkIdx = trimmed.indexOf('CHECK');
		if (checkIdx === -1) continue;

		let depth = 0;
		let start = -1;
		let end = -1;
		for (let i = checkIdx + 5; i < trimmed.length; i++) {
			if (trimmed[i] === '(') {
				if (depth === 0) start = i;
				depth++;
			} else if (trimmed[i] === ')') {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (start !== -1 && end !== -1) {
			checks.add(normalize(trimmed.slice(start + 1, end)));
		}
	}
	return checks;
};
```

For `chart_scores`, compare schema checks against the original `0002` `CREATE TABLE chart_scores` block **plus** the two one-line `ALTER TABLE chart_scores ADD COLUMN ... CHECK (...)` statements from `0007`:

```ts
const migration2 = readFileSync(join(MIGRATIONS_DIR, '0002_scores.sql'), 'utf8');
const migration7 = readFileSync(join(MIGRATIONS_DIR, '0007_score_semantics.sql'), 'utf8');
const chartScoresCreate =
	migration2.match(/CREATE TABLE IF NOT EXISTS chart_scores \([\s\S]*?\);/)?.[0] ?? '';
const chartScoreAdds = migration7
	.split('\n')
	.filter((line) => line.includes('ALTER TABLE chart_scores ADD COLUMN'))
	.join('\n');
const migrationChecks = parseMigrationChecks(`${chartScoresCreate}\n${chartScoreAdds}`);
```

For `scores`, compare against `0007`’s authoritative rebuilt table:

```ts
const scoresBlock =
	migration7.match(/CREATE TABLE scores_v2 \([\s\S]*?\);/)?.[0] ?? '';
const migrationChecks = parseMigrationChecks(scoresBlock);
```

Continue comparing normalized expression sets to the checks parsed from `schema.ts`.

- [ ] **Step 6: Extend the atomic upsert and preserve nullable clear state**

Change `upsertChartScoreAndReplaceScores` parameters to include:

```ts
fullCombo: boolean;
maxCombo: number;
```

Persist them in the existing chart upsert:

```sql
INSERT INTO chart_scores
    (chart_id, user_id, play_count, clear_count, full_combo, max_combo, created_at, updated_at)
SELECT ?, ?, ?, ?, ?, ?, ?, ?
...
ON CONFLICT(user_id, chart_id) DO UPDATE SET
    play_count = excluded.play_count,
    clear_count = excluded.clear_count,
    full_combo = excluded.full_combo,
    max_combo = excluded.max_combo,
    updated_at = excluded.updated_at
RETURNING *
```

Remove score-level `full_combo` / `max_combo` columns and binds. Bind clear state without coercing `null` to `0`:

```ts
s.cleared == null ? null : s.cleared ? 1 : 0
```

Do not change the visibility subquery or batch ordering.

- [ ] **Step 7: Update all common fixtures that pin the old shape**

In `db.integration.test.ts`:

- update the expected migration list through `0007_score_semantics.sql`;
- change `scoreInput` to remove `full_combo` / `max_combo` and allow `cleared: boolean | null`;
- add `fullCombo` / `maxCombo` to every `upsertChartScoreAndReplaceScores` invocation;
- update the hand-built TOCTOU `chart_scores` DDL with `full_combo` and `max_combo`;
- update the hand-built TOCTOU `scores` DDL to remove `full_combo` / `max_combo` and make `cleared` nullable;
- update direct inserts/assertions to the new ownership.

Use searches as a completion check:

```bash
rg "upsertChartScoreAndReplaceScores\(" packages/common/src/lib/server
rg "full_combo|max_combo|cleared" packages/common/src/lib/server/db.integration.test.ts
```

In `db.test.ts`, update all mocked/direct `ChartScoreRow`, `ScoreRow`, and `ScoreInsert` fixtures to compile under the new contract.

- [ ] **Step 8: Run common tests**

```bash
bun run --filter=@dtx/common test
```

Expected: all common tests pass, including current CHECK parity, the explicit `0001..0006 -> old data -> 0007` migration test, the TOCTOU test, and replacement/read coverage.

- [ ] **Step 9: Commit Task 1**

```bash
git add packages/dtx-api/d1-migrations/0007_score_semantics.sql \
  packages/common/src/lib/server/db/schema.ts \
  packages/common/src/lib/types/d1.types.ts \
  packages/common/src/lib/server/db.ts \
  packages/common/src/lib/server/db.test.ts \
  packages/common/src/lib/server/db.integration.test.ts
git commit -m "fix: separate chart score aggregates"
```

---

## Task 2: Make GraphQL expose and accept the truthful contract

**Files:**
- Modify: `packages/dtx-api/src/schema/score.ts`
- Test: `packages/dtx-api/src/schema/score.test.ts`
- Regenerate: `packages/dtx-api/dist/schema.graphql`

**Interfaces:**
- Consumes: Task 1 `ChartScoreRow.full_combo/max_combo` and updated common DB write input.
- Produces: `ChartScore.fullCombo: Boolean!`, `ChartScore.maxCombo: Int!`, `Score.cleared: Boolean`, and chart-level upload aggregate fields.

- [ ] **Step 1: Update API test fixtures to the new ownership before changing the resolver**

Treat `score.test.ts` as a contract-wide fixture update, not a one-test edit. Change every `ChartScoreRow` mock to include:

```ts
full_combo: 0,
max_combo: 0,
```

or the values needed by that test. Remove `full_combo` / `max_combo` from every `ScoreRow` mock. Make best-row `cleared` / `performed_at` null where the test represents stored canonical data.

For every `UploadScoresInput` fixture:

```ts
{
	chartId: '10',
	playCount: 7,
	clearCount: 4,
	fullCombo: true,
	maxCombo: 812,
	scores: [
		{
			isBest: true,
			score: 987654,
			achievementRate: 96.25,
			rankLabel: 'SS',
			cleared: true,
			performedAt: '2026-08-14T12:00:00Z',
			perfect: 700,
			great: 80,
			good: 20,
			poor: 8,
			miss: 4
		},
		{
			isBest: false,
			achievementRate: 81.5,
			rankLabel: 'S',
			cleared: null,
			performedAt: '2026-08-14T13:00:00Z',
			displayOrder: 1
		}
	]
}
```

Keep one best input deliberately carrying `cleared: true` and a timestamp so the server test proves canonicalization to `null`.

Search the whole test file before moving on:

```bash
rg "fullCombo|maxCombo|full_combo|max_combo|cleared" packages/dtx-api/src/schema/score.test.ts
```

Every remaining match must reflect chart-level aggregate ownership or nullable score clear state.

- [ ] **Step 2: Run the API score suite and confirm the new fixtures fail against the old schema**

```bash
bun run --filter=dtx-api test -- score.test.ts
```

Expected: GraphQL/type failures because `ChartScoresInput` lacks the aggregate fields, `ChartScore` does not expose them, and `Score.cleared` is non-null.

- [ ] **Step 3: Move aggregate fields from `ScoreRef` to `ChartScoreRef`**

Remove score-level `fullCombo` and `maxCombo` resolvers. Make `cleared` nullable:

```ts
cleared: t.boolean({
	nullable: true,
	resolve: (s) => (s.cleared == null ? null : s.cleared === 1)
}),
```

Add chart-level fields:

```ts
fullCombo: t.boolean({ resolve: (c) => c.chartScore.full_combo === 1 }),
maxCombo: t.int({ resolve: (c) => c.chartScore.max_combo }),
```

- [ ] **Step 4: Change upload input/types and validation ownership**

Remove `fullCombo` / `maxCombo` from `ScoreInput` and `InputScore`. Make clear state nullable/optional:

```ts
cleared: t.boolean({ required: false }),
```

```ts
type InputScore = {
	isBest: boolean;
	score?: number | null;
	achievementRate?: number | null;
	rankLabel?: string | null;
	cleared?: boolean | null;
	perfect?: number | null;
	great?: number | null;
	good?: number | null;
	poor?: number | null;
	miss?: number | null;
	performedAt?: string | null;
	displayOrder?: number | null;
};
```

Add chart input fields:

```ts
fullCombo: t.boolean({ required: true }),
maxCombo: t.int({ required: true }),
```

Move `maxCombo` validation to `validateChartScores`:

```ts
const validateChartScores = (
	playCount: number,
	clearCount: number,
	maxCombo: number,
	scores: InputScore[]
): ValidationResult => {
	if (!Number.isSafeInteger(maxCombo) || maxCombo < 0) {
		return { ok: false, reason: 'maxCombo must be a non-negative integer' };
	}
	// existing play/clear/best/recent checks...
};
```

Remove `s.maxCombo` from `validateScoreFields`:

```ts
const counts = [s.perfect, s.great, s.good, s.poor, s.miss];
```

Do not leave score-level `maxCombo` validation after the field leaves `InputScore`.

- [ ] **Step 5: Canonicalize best rows at the existing server normalization seam**

At the start of the per-score loop, normalize all best-only metadata before timestamp parsing or field validation:

```ts
for (const s of scores) {
	let row: InputScore = s.isBest
		? {
				...s,
				cleared: null,
				performedAt: null,
				displayOrder: null
			}
		: s;

	// existing rank sanitization
	// existing future-date clamp now applies only when performedAt is present
	// existing field validation and recent displayOrder validation
}
```

This extends the current best-`displayOrder` cleanup rather than adding another normalization pipeline. Keep exactly-one-best, recent-row cap, rank sanitization, visibility checks, future-date clamping for recent rows, rate limiting, and write concurrency unchanged.

- [ ] **Step 6: Pass aggregates to the common write and preserve nullable score results**

Call:

```ts
await upsertChartScoreAndReplaceScores(ctx.env.DB, {
	chartId,
	userId: ctx.user.id,
	playCount: chart.playCount,
	clearCount: chart.clearCount,
	fullCombo: chart.fullCombo,
	maxCombo: chart.maxCombo,
	scores: validScores.map((score) => ({
		is_best: score.isBest,
		score: score.score ?? null,
		achievement_rate: score.achievementRate ?? null,
		rank_label: score.rankLabel ?? null,
		cleared: score.cleared ?? null,
		perfect: score.perfect ?? null,
		great: score.great ?? null,
		good: score.good ?? null,
		poor: score.poor ?? null,
		miss: score.miss ?? null,
		performed_at: score.performedAt ?? null,
		display_order: score.displayOrder ?? null
	}))
});
```

Keep the existing response envelope and skip behavior.

- [ ] **Step 7: Pin resolver + canonicalization behavior in API tests**

Assert the GraphQL result exposes chart aggregates and nullable best/recent clear state:

```ts
expect(chartScore.fullCombo).toBe(true);
expect(chartScore.maxCombo).toBe(812);
expect(best.cleared).toBeNull();
expect(best.performedAt).toBeNull();
expect(recent.cleared).toBeNull();
```

Also assert the common write mock receives chart-level `fullCombo` / `maxCombo` and a best score with `cleared: null`, `performed_at: null`, `display_order: null` even when stale best metadata was sent in the GraphQL input.

- [ ] **Step 8: Run API tests/typecheck, then regenerate the committed schema**

```bash
bun run --filter=dtx-api test
bun run --filter=dtx-api check
bun run --filter=dtx-api gen-schema
```

Verify the generated schema has:

```graphql
type ChartScore {
  # existing fields
  fullCombo: Boolean!
  maxCombo: Int!
}

type Score {
  cleared: Boolean
  # no fullCombo or maxCombo
}
```

and `ChartScoresInput` owns the aggregate inputs.

- [ ] **Step 9: Commit Task 2 including the generated schema artifact**

```bash
git add packages/dtx-api/src/schema/score.ts \
  packages/dtx-api/src/schema/score.test.ts \
  packages/dtx-api/dist/schema.graphql
git commit -m "fix: expose truthful score contract"
```

---

## Task 3: Correct desktop parsing, upload payloads, fixtures, and local score preview

**Files:**
- Modify: `packages/dtx-desktop/src-tauri/src/scores.rs`
- Test: `packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs`
- Modify: `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/Scores.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/ScoreChartRow.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/ScoreChartRow.test.ts`

**Interfaces:**
- Consumes: Task 2 chart-level upload contract.
- Produces: parsed desktop charts with `{ playCount, clearCount, fullCombo, maxCombo }` aggregates and score rows whose `cleared` is `boolean | null`.

- [ ] **Step 1: Update the existing Rust parser regression fixture, not a parallel test model**

In `scores_tests.rs`, update `parse_maps_best_recent_and_ignores_non_drums` (and its fixture helpers) with deliberately distinct source facts:

```text
BestScore = 987654
BestAchievementRate = 96.25
BestPerfect/Great/Good/Poor/Miss = 700/80/20/8/4
FullCombo = 1
ClearCount = 4
PlayCount = 7
MaxCombo = 812
LastPlayedAt = 2026-08-14T13:00:00Z
```

Assert:

```rust
let chart = &songs[0].charts[0];
assert_eq!(chart.aggregate.play_count, 7);
assert_eq!(chart.aggregate.clear_count, 4);
assert!(chart.aggregate.full_combo);
assert_eq!(chart.aggregate.max_combo, 812);

let best = chart.best.as_ref().unwrap();
assert_eq!(best.score, Some(987654));
assert_eq!(best.cleared, None);
assert_eq!(best.performed_at, None);
assert_eq!(best.perfect, Some(700));
```

Update the malformed recent-history assertion that currently treats parser failure as `cleared == false`; it must assert `None`. Preserve the separate `ParsedHistory.cleared: Option<bool>` parser tests for explicit Cleared/Failed tokens.

- [ ] **Step 2: Run targeted Rust score tests and verify the old output contract fails**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml scores
```

Expected: failures because `ChartAggregate` lacks the aggregate fields, best metadata is still invented, and malformed recent history is coerced to false.

- [ ] **Step 3: Narrow `ScorePayload` and extend `ChartAggregate`**

Use:

```rust
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScorePayload {
    pub is_best: bool,
    pub score: Option<i64>,
    pub achievement_rate: Option<f64>,
    pub rank_label: Option<String>,
    pub cleared: Option<bool>,
    pub perfect: Option<i64>,
    pub great: Option<i64>,
    pub good: Option<i64>,
    pub poor: Option<i64>,
    pub miss: Option<i64>,
    pub performed_at: Option<String>,
    pub display_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChartAggregate {
    pub play_count: i64,
    pub clear_count: i64,
    pub full_combo: bool,
    pub max_combo: i64,
}
```

Keep `DrumsScoreRow.full_combo`, `.max_combo`, and `.last_played_at` because the SQLite source query still reads those fields; only output ownership changes.

- [ ] **Step 4: Make `build_best` emit only the coherent best stat block**

```rust
Some(ScorePayload {
    is_best: true,
    score: Some(score.best_score),
    achievement_rate,
    rank_label,
    cleared: None,
    perfect: Some(score.best_perfect),
    great: Some(score.best_great),
    good: Some(score.best_good),
    poor: Some(score.best_poor),
    miss: Some(score.best_miss),
    performed_at: None,
    display_order: None,
})
```

Do not match `PerformanceHistory` to infer a best timestamp or clear result.

- [ ] **Step 5: Build chart aggregates and preserve unknown recent results**

At chart creation:

```rust
aggregate: ChartAggregate {
    play_count: row.score.play_count,
    clear_count: row.score.clear_count,
    full_combo: row.score.full_combo != 0,
    max_combo: row.score.max_combo,
},
```

For recent rows replace:

```rust
cleared: parsed.cleared.unwrap_or(false),
```

with:

```rust
cleared: parsed.cleared,
```

Remove score-level full-combo/max-combo construction.

- [ ] **Step 6: Update renderer types and `Scores.test.ts` fixtures before changing upload assembly**

`scoreTypes.ts`:

```ts
export interface ScorePayload {
	isBest: boolean;
	score: number | null;
	achievementRate: number | null;
	rankLabel: string | null;
	cleared: boolean | null;
	perfect: number | null;
	great: number | null;
	good: number | null;
	poor: number | null;
	miss: number | null;
	performedAt: string | null;
	displayOrder: number | null;
}
```

`LocalChartData.aggregate`:

```ts
aggregate: {
	playCount: number;
	clearCount: number;
	fullCombo: boolean;
	maxCombo: number;
};
```

In `Scores.test.ts`:

- remove `fullCombo` / `maxCombo` from `bestRow` and `recentRow`;
- set the canonical best fixture to `cleared: null`, `performedAt: null`;
- add `fullCombo: true`, `maxCombo: 800` to `parsedSongs[0].charts[0].aggregate`;
- update the upload expectation so the chart object contains `fullCombo` / `maxCombo` and `scores` contains the narrowed rows.

Expected upload shape:

```ts
expect(host.uploadScores).toHaveBeenCalledWith({
	charts: [
		{
			chartId: '10',
			playCount: 7,
			clearCount: 5,
			fullCombo: true,
			maxCombo: 800,
			scores: [bestRow, recentRow]
		}
	]
});
```

- [ ] **Step 7: Send aggregate fields from `Scores.svelte::buildUpload`**

Extend the local chart upload object/type with:

```ts
fullCombo: boolean;
maxCombo: number;
```

and push:

```ts
charts.push({
	chartId,
	playCount: chart.aggregate.playCount,
	clearCount: chart.aggregate.clearCount,
	fullCombo: chart.aggregate.fullCombo,
	maxCombo: chart.aggregate.maxCombo,
	scores
});
```

Leave batching, restore/link behavior, duplicate matching, and raw fallback for unknown server skip reasons unchanged.

- [ ] **Step 8: Move aggregate display to chart level and render tri-state recent outcomes**

In `ScoreChartRow.svelte`, remove `maxCombo` / `fullCombo` from `bestParts`. Render them with the chart aggregate summary instead:

```svelte
<span class="text-dim">{$_('score.combo')} {chart.aggregate.maxCombo}</span>
{#if chart.aggregate.fullCombo}
	<span class="text-green">{$_('score.full_combo')}</span>
{/if}
```

Render result state explicitly:

```svelte
{#if recent.cleared === true}
	<span class="text-green-300">{$_('score.cleared')}</span>
{:else if recent.cleared === false}
	<span class="text-red-300">{$_('score.failed')}</span>
{:else}
	<span class="text-faint">—</span>
{/if}
```

- [ ] **Step 9: Update `ScoreChartRow.test.ts` for ownership and separators**

Use a chart fixture with:

```ts
aggregate: {
	playCount: 7,
	clearCount: 4,
	fullCombo: true,
	maxCombo: 812
}
```

and a best row with no aggregate fields. Assert:

- combo/full-combo still render exactly once at chart level;
- best summary separators remain correct after those segments are removed;
- recent `cleared: true`, `false`, and `null` render Cleared, Failed, and the neutral dash respectively.

- [ ] **Step 10: Run native + renderer tests and the actual desktop typecheck script**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
```

Expected: all native tests, `Scores.test.ts`, `ScoreChartRow.test.ts`, and Svelte/TypeScript checks pass.

- [ ] **Step 11: Commit Task 3**

```bash
git add packages/dtx-desktop/src-tauri/src/scores.rs \
  packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs \
  packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts \
  packages/dtx-desktop/src/renderer/src/components/Scores.svelte \
  packages/dtx-desktop/src/renderer/src/components/Scores.test.ts \
  packages/dtx-desktop/src/renderer/src/components/ScoreChartRow.svelte \
  packages/dtx-desktop/src/renderer/src/components/ScoreChartRow.test.ts
git commit -m "fix: preserve score import semantics"
```

---

## Task 4: Update web adapters, presentation, and the existing score E2E contract

**Files:**
- Modify: `packages/dtx-web/src/lib/api/operations/score.graphql`
- Regenerate: `packages/dtx-web/src/lib/api/generated/graphql.ts`
- Modify: `packages/dtx-web/src/lib/api/score.ts`
- Test: `packages/dtx-web/src/lib/api/score.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ScoreCard.svelte`
- Test: `packages/dtx-web/src/lib/components/ScoreCard.test.ts`
- Test fixture: `packages/dtx-web/src/routes/(app)/app/score/score-page.test.ts`
- Existing E2E contract: `packages/e2e-web/score.spec.ts`

**Interfaces:**
- Consumes: Task 2 committed API schema and Task 3 upload shape.
- Produces: web view models/rendering and the existing end-to-end score round-trip using chart-level aggregates and nullable clear state.

- [ ] **Step 1: Change the GraphQL operation**

Inside `myChartScore`, request:

```graphql
playCount
clearCount
fullCombo
maxCombo
scores {
  id
  isBest
  score
  achievementRate
  rankLabel
  cleared
  perfect
  great
  good
  poor
  miss
  performedAt
  displayOrder
}
```

Remove score-level `fullCombo` and `maxCombo` selections.

- [ ] **Step 2: Regenerate the API schema first, then the web client**

Web codegen reads `packages/dtx-api/dist/schema.graphql`, so always refresh that artifact before generating client types:

```bash
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
```

Expected: generated web types expose `ChartScore.fullCombo/maxCombo` and nullable `Score.cleared`.

- [ ] **Step 3: Update web adapter fixtures and view types**

In `score.test.ts`, use a raw GraphQL fixture with chart-level aggregates and no score-level aggregates:

```ts
myChartScore: {
	playCount: 7,
	clearCount: 4,
	fullCombo: true,
	maxCombo: 812,
	scores: [
		{
			id: '1',
			isBest: true,
			score: 987654,
			achievementRate: 96.25,
			rankLabel: 'SS',
			cleared: null,
			perfect: 700,
			great: 80,
			good: 20,
			poor: 8,
			miss: 4,
			performedAt: null,
			displayOrder: null
		}
	]
}
```

Narrow `ScoreView` to remove `fullCombo` / `maxCombo`, change `cleared` to `boolean | null`, and extend `ChartScoreView`:

```ts
export type ChartScoreView = {
	playCount: number;
	clearCount: number;
	fullCombo: boolean;
	maxCombo: number;
	best: ScoreView | null;
	recent: ScoreView[];
};
```

Remove aggregate assignments from `toScoreView`; add:

```ts
fullCombo: cs.fullCombo,
maxCombo: cs.maxCombo,
```

to `toChartScoreView`.

- [ ] **Step 4: Update `score-page.test.ts` because its typed fixture pins the old view model**

Move:

```ts
fullCombo: false,
maxCombo: 800,
```

from `chartScore.best` to `chartScore`, and make the best fixture truthful:

```ts
chartScore: {
	playCount: 5,
	clearCount: 2,
	fullCombo: false,
	maxCombo: 800,
	best: {
		id: 1,
		isBest: true,
		score: 900000,
		achievementRate: 90,
		rankLabel: 'A',
		cleared: null,
		perfect: 1,
		great: 1,
		good: 1,
		poor: 1,
		miss: 1,
		performedAt: null,
		displayOrder: null
	},
	recent: []
}
```

Do not add page behavior; this is only the existing typed fixture following the new model.

- [ ] **Step 5: Move aggregate presentation out of the best row**

In `ScoreCard.svelte`, render `chart.chartScore.fullCombo` and `chart.chartScore.maxCombo` in the chart summary near play/clear counts.

Remove best-row access to those two properties. Keep best score, achievement rate, rank, and judgment display unchanged.

Render recent result tri-state:

```svelte
{#if recent.cleared === true}
	<span class="text-green-300">{$_('score.cleared')}</span>
{:else if recent.cleared === false}
	<span class="text-red-300">{$_('score.failed')}</span>
{:else}
	<span class="text-slate-500">—</span>
{/if}
```

No new translation copy is needed.

- [ ] **Step 6: Update `ScoreCard.test.ts`**

Pin four behaviors:

1. chart aggregate `fullCombo: true` renders the full-combo badge;
2. chart aggregate `maxCombo: 812` renders max combo once;
3. best score still renders score/rank/rate/judgments without aggregate properties;
4. recent `cleared: null` renders neither Cleared nor Failed while true/false rows keep existing copy.

- [ ] **Step 7: Update the existing Playwright score round-trip fixture and query**

In `packages/e2e-web/score.spec.ts`, change both `ROUND_TRIP_PAYLOAD` and `scorePagePayload` so `fullCombo` / `maxCombo` live on each chart input:

```ts
{
	chartId,
	playCount: 12,
	clearCount: 8,
	fullCombo: true,
	maxCombo: 432,
	scores: [
		{
			isBest: true,
			score: 983400,
			achievementRate: 98.34,
			rankLabel: 'SS',
			cleared: null,
			perfect: 210,
			great: 180,
			good: 30,
			poor: 12,
			miss: 8,
			performedAt: null,
			displayOrder: null
		}
	]
}
```

Recent rows retain their actual `cleared: true | false` values and timestamps, but remove score-level full-combo/max-combo.

Change the E2E GraphQL query/type so `myChartScore` selects/types:

```graphql
playCount
clearCount
fullCombo
maxCombo
scores {
  isBest
  score
  achievementRate
  rankLabel
  cleared
  perfect
  great
  good
  poor
  miss
  performedAt
  displayOrder
}
```

Update round-trip assertions:

```ts
expect(chartScore.fullCombo).toBe(true);
expect(chartScore.maxCombo).toBe(432);
expect(bestScore!.cleared).toBeNull();
```

Keep the same existing upload round-trip and score-page UI scenarios; do not add another Playwright test.

- [ ] **Step 8: Run web units, generated-code drift checks, and E2E typecheck**

```bash
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-web lint:codegen
bun run --filter=dtx-e2e-web check
```

Expected: all web unit tests and TypeScript/codegen gates pass with the updated `score-page.test.ts` and E2E fixture.

- [ ] **Step 9: Commit Task 4**

```bash
git add packages/dtx-web/src/lib/api/operations/score.graphql \
  packages/dtx-web/src/lib/api/generated/graphql.ts \
  packages/dtx-web/src/lib/api/score.ts \
  packages/dtx-web/src/lib/api/score.test.ts \
  packages/dtx-web/src/lib/components/ScoreCard.svelte \
  packages/dtx-web/src/lib/components/ScoreCard.test.ts \
  'packages/dtx-web/src/routes/(app)/app/score/score-page.test.ts' \
  packages/e2e-web/score.spec.ts
git commit -m "fix: render truthful chart scores"
```

---

## Task 5: Run the complete existing score-contract regression gate

**Files:**
- No planned file changes. Any failure indicates an omission in Tasks 1–4 and should be fixed in the task that owns that boundary before continuing.

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: one verified breaking score-contract change with no stale old-shape references.

- [ ] **Step 1: Search for stale score-level aggregate ownership and null coercion**

```bash
rg "\.fullCombo|\.maxCombo|full_combo|max_combo" \
  packages/common packages/dtx-api packages/dtx-desktop packages/dtx-web packages/e2e-web
```

Review every match. Valid matches are:

- `ChartScore` / `ChartAggregate` ownership;
- DTXManiaCX source-row fields in Rust;
- `0007` migration backfill references to the removed old `scores` columns;
- unrelated domains.

There must be no `ScoreRow`, `ScorePayload`, `ScoreView`, GraphQL `Score`, or score E2E query ownership of full-combo/max-combo.

Then search result coercion:

```bash
rg "unwrap_or\(false\)|cleared\s*\?\s*1\s*:\s*0" \
  packages/common packages/dtx-api packages/dtx-desktop packages/dtx-web packages/e2e-web
```

No score-history/write path may convert unknown clear state to failure/zero.

- [ ] **Step 2: Verify generated GraphQL artifacts in dependency order**

```bash
bun run --filter=dtx-api gen-schema
git diff --exit-code -- packages/dtx-api/dist/schema.graphql
bun run --filter=dtx-web lint:codegen
```

Expected: no generated schema/client drift.

- [ ] **Step 3: Run affected unit/native/type gates**

```bash
bun run --filter=@dtx/common test
bun run --filter=dtx-api test
bun run --filter=dtx-api check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-e2e-web check
```

Expected: all affected unit, native, Svelte, API, and E2E TypeScript checks pass.

- [ ] **Step 4: Run the existing score E2E spec**

Use the existing Playwright package/script; run only the score spec:

```bash
bun run --filter=dtx-e2e-web e2e -- score.spec.ts
```

Expected: the existing upload round-trip and `/app/score` UI scenarios pass with chart-level full-combo/max-combo and a null best clear state.

- [ ] **Step 5: Run diff hygiene**

```bash
git diff --check main...HEAD
```

Expected: no whitespace errors.

## Plan self-review

- **Spec coverage:** D1 migration/backfill, current migration/schema CHECK parity, common DB writes/readers, GraphQL schema/input normalization, committed API schema, desktop parser/upload/rendering, all directly affected desktop fixtures, web query/adapter/rendering, typed score-page fixture, and the existing score E2E flow are explicitly assigned.
- **Migration coverage:** a dedicated real-D1 test applies `0001`–`0006`, inserts an old-shape score row, applies `0007`, and verifies both aggregate backfill and best-row nulling; fresh-schema tests are not used as a substitute.
- **Semantic coverage:** best score keeps only the DTXManiaCX stat block updated together; chart-level full-combo/max-combo are preserved; best timestamp/result are cleared; malformed recent result remains unknown; nullable clear survives the D1 bind.
- **Fixture coverage:** `db.test.ts`, `db.integration.test.ts`, `score.test.ts`, `scores_tests.rs`, `Scores.test.ts`, `ScoreChartRow.test.ts`, `score.test.ts` (web adapter), `ScoreCard.test.ts`, `score-page.test.ts`, and `e2e-web/score.spec.ts` all follow the same ownership.
- **Generated-file coverage:** Task 2 regenerates and commits `packages/dtx-api/dist/schema.graphql`; Task 4 regenerates web GraphQL types only after that schema is current.
- **Command accuracy:** desktop uses `typecheck`; API uses `gen-schema`; web codegen consumes the generated API schema; the final gate runs the existing score Playwright spec.
- **Scope check:** no new table/domain abstraction, no history feature, no compatibility/version layer, no new E2E scenario, and no unrelated upload/navigation changes.
- **Type consistency:** `ChartScore` owns `fullCombo: boolean` / `maxCombo: number`; `Score.cleared` is nullable end-to-end; score-level full-combo/max-combo are removed at every boundary.
- **Placeholder scan:** no `TBD`, `TODO`, generic “write tests”, or unnamed implementation step remains.