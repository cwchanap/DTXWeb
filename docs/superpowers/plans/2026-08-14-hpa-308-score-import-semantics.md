# HPA-308 Score Import Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make imported score data truthful by keeping only the supported best-score stat block on the distinguished best row, moving chart-wide/best-skill/latest-play records to `ChartScore`, and preserving unknown recent clear state as unknown.

**Architecture:** Keep the existing `ChartScore` + `Score` model and atomic replace-all upload path. `chart_scores` remains the per-user chart-record owner; `scores` remains best/recent row storage. Move `fullCombo`, `maxCombo`, `bestAchievementRate`, its derived rank label, and `lastPlayedAt` to `ChartScore`; canonicalize the best row to numeric score + judgment block only; keep recent rows history-derived.

**Tech Stack:** Cloudflare D1 / SQLite migrations, TypeScript, Drizzle schema definitions, Pothos GraphQL, Svelte 5, Rust + rusqlite/Tauri, Vitest, Cargo tests, GraphQL Code Generator, Playwright, Cloudflare Wrangler, GitHub Actions/Tauri updater.

## Global Constraints

- Keep `chart_scores` as the sole per-user chart aggregate/record and `scores` as best/recent rows; do not add a new domain table.
- Preserve the existing atomic `upsert chart_scores -> delete scores -> insert replacement scores` D1 batch and visibility gate.
- Preserve exactly one best row and at most five recent rows per uploaded chart.
- Best row keeps `BestScore` plus `BestPerfect/BestGreat/BestGood/BestPoor/BestMiss`; its `achievementRate`, `rankLabel`, `cleared`, `performedAt`, and `displayOrder` are `null`.
- `ChartScore` owns `playCount`, `clearCount`, `fullCombo`, `maxCombo`, `bestAchievementRate`, `bestRankLabel`, and `lastPlayedAt`.
- `bestAchievementRate`, `bestRankLabel`, and `lastPlayedAt` are nullable; `maxCombo` is a non-negative integer with default `0`.
- Recent `cleared` is tri-state: `true`, `false`, or `null` when `HistoryLine` cannot determine the result.
- Remove `fullCombo` and `maxCombo` from the `Score` persistence/API/client shape instead of keeping aliases or deprecated fields.
- Do not version the GraphQL mutation or preserve the old upload shape; this is an intentional breaking change.
- Do not change chart matching, upload batching, score pagination, authentication, navigation, or history retention.
- Update the existing `packages/e2e-web/score.spec.ts`; do not add a second E2E scenario.
- Generated GraphQL artifacts remain committed: API schema first, then web client types.
- Task-local commits are intentionally **cross-package red** while the breaking contract is moved one boundary at a time. Task-local tests must pass, but the repository-wide type/build gate is expected to become green only after Task 4; do not treat intermediate cross-package errors as regressions.
- The only semantic grep retained in the final gate is the `unwrap_or(false)` history coercion check; ownership drift is covered by narrowed types and compilers.

---

## Task 1: Move records into the D1/common contract and prove migration 0007

**Files:**

- Create: `packages/dtx-api/d1-migrations/0007_score_semantics.sql`
- Modify: `packages/common/src/lib/server/db/schema.ts`
- Modify: `packages/common/src/lib/types/d1.types.ts`
- Modify: `packages/common/src/lib/server/db.ts`
- Test: `packages/common/src/lib/server/db.test.ts`
- Test: `packages/common/src/lib/server/db.integration.test.ts`

**Interfaces:**

- Consumes: existing `upsertChartScoreAndReplaceScores(db, params)`, `getUserChartScore`, and `listUserChartScores`.
- Produces: chart-level `full_combo`, `max_combo`, `best_achievement_rate`, `best_rank_label`, `last_played_at`; nullable score `cleared`; D1 best-row CHECK; updated atomic write parameters.

- [ ] **Step 1: Add a real old-shape → 0007 migration regression**

In `db.integration.test.ts`, add helpers that can stop the migration chain at a named file:

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

Add one test that drops the score/schema tables, applies `0001`–`0006`, seeds the old 0002 shape, then applies `0007`:

```ts
it('0007 relocates chart records and canonicalizes the best row', async () => {
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
		.bind(chartScore!.id, 987654, 96.25, 'SS', 812, 700, 80, 20, 8, 4, '2026-08-14T13:00:00Z')
		.run();

	const before = await db
		.prepare('SELECT id FROM scores WHERE chart_score_id = ? AND is_best = 1')
		.bind(chartScore!.id)
		.first<{ id: number }>();

	await runMigration(migrationNamed('0007_score_semantics.sql').statements);

	const migratedChart = await db
		.prepare(
			`SELECT full_combo, max_combo, best_achievement_rate,
			        best_rank_label, last_played_at
			 FROM chart_scores WHERE id = ?`
		)
		.bind(chartScore!.id)
		.first<{
			full_combo: number;
			max_combo: number;
			best_achievement_rate: number | null;
			best_rank_label: string | null;
			last_played_at: string | null;
		}>();

	expect(migratedChart).toEqual({
		full_combo: 1,
		max_combo: 812,
		best_achievement_rate: 96.25,
		best_rank_label: 'SS',
		last_played_at: '2026-08-14T13:00:00Z'
	});

	const migratedBest = await db
		.prepare(
			`SELECT id, score, achievement_rate, rank_label, cleared,
			        perfect, great, good, poor, miss, performed_at, display_order
			 FROM scores WHERE chart_score_id = ? AND is_best = 1`
		)
		.bind(chartScore!.id)
		.first<Record<string, unknown>>();

	expect(migratedBest).toMatchObject({
		id: before!.id,
		score: 987654,
		achievement_rate: null,
		rank_label: null,
		cleared: null,
		perfect: 700,
		great: 80,
		good: 20,
		poor: 8,
		miss: 4,
		performed_at: null,
		display_order: null
	});

	const sequence = await db
		.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'scores'`)
		.first<{ seq: number }>();
	expect(sequence!.seq).toBeGreaterThanOrEqual(before!.id);
});
```

This is the migration verification for the risky SQL. Do not substitute a fresh-schema test.

- [ ] **Step 2: Run the migration regression and confirm it fails before 0007 exists**

```bash
bun run --filter=@dtx/common test -- db.integration.test.ts
```

Expected: FAIL because `0007_score_semantics.sql` and the new chart columns do not exist.

- [ ] **Step 3: Add `0007_score_semantics.sql`**

Add the chart columns and backfill them from the old best row:

```sql
ALTER TABLE chart_scores ADD COLUMN full_combo INTEGER NOT NULL DEFAULT 0 CHECK (full_combo IN (0, 1));
ALTER TABLE chart_scores ADD COLUMN max_combo INTEGER NOT NULL DEFAULT 0 CHECK (max_combo >= 0);
ALTER TABLE chart_scores ADD COLUMN best_achievement_rate REAL CHECK (best_achievement_rate IS NULL OR (best_achievement_rate >= 0 AND best_achievement_rate <= 100));
ALTER TABLE chart_scores ADD COLUMN best_rank_label TEXT CHECK (best_rank_label IS NULL OR best_rank_label IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'));
ALTER TABLE chart_scores ADD COLUMN last_played_at TEXT;

UPDATE chart_scores
SET full_combo = COALESCE((
        SELECT s.full_combo FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    ), 0),
    max_combo = COALESCE((
        SELECT s.max_combo FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    ), 0),
    best_achievement_rate = (
        SELECT s.achievement_rate FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    ),
    best_rank_label = (
        SELECT s.rank_label FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    ),
    last_played_at = (
        SELECT s.performed_at FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    );
```

Rebuild `scores` with recent-capable rate/rank columns but no score-level full-combo/max-combo:

```sql
CREATE TABLE scores_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_score_id INTEGER NOT NULL,
    is_best INTEGER NOT NULL DEFAULT 0 CHECK (is_best IN (0, 1)),
    score INTEGER CHECK (score IS NULL OR score >= 0),
    achievement_rate REAL CHECK (achievement_rate IS NULL OR (achievement_rate >= 0 AND achievement_rate <= 100)),
    rank_label TEXT CHECK (rank_label IS NULL OR rank_label IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F')),
    cleared INTEGER CHECK (cleared IS NULL OR cleared IN (0, 1)),
    perfect INTEGER CHECK (perfect IS NULL OR perfect >= 0),
    great INTEGER CHECK (great IS NULL OR great >= 0),
    good INTEGER CHECK (good IS NULL OR good >= 0),
    poor INTEGER CHECK (poor IS NULL OR poor >= 0),
    miss INTEGER CHECK (miss IS NULL OR miss >= 0),
    performed_at TEXT,
    display_order INTEGER CHECK (display_order IS NULL OR (display_order >= 1 AND display_order <= 5)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_score_id) REFERENCES chart_scores(id) ON DELETE CASCADE,
    CHECK (is_best = 0 OR (achievement_rate IS NULL AND rank_label IS NULL AND cleared IS NULL AND performed_at IS NULL AND display_order IS NULL))
);

INSERT INTO scores_v2 (
    id, chart_score_id, is_best, score, achievement_rate, rank_label,
    cleared, perfect, great, good, poor, miss, performed_at,
    display_order, created_at
)
SELECT
    id,
    chart_score_id,
    is_best,
    score,
    CASE WHEN is_best = 1 THEN NULL ELSE achievement_rate END,
    CASE WHEN is_best = 1 THEN NULL ELSE rank_label END,
    CASE WHEN is_best = 1 THEN NULL ELSE cleared END,
    perfect, great, good, poor, miss,
    CASE WHEN is_best = 1 THEN NULL ELSE performed_at END,
    CASE WHEN is_best = 1 THEN NULL ELSE display_order END,
    created_at
FROM scores;

DROP TABLE scores;
ALTER TABLE scores_v2 RENAME TO scores;

CREATE INDEX idx_scores_chart_score ON scores(chart_score_id);
CREATE UNIQUE INDEX idx_scores_one_best ON scores(chart_score_id) WHERE is_best = 1;
CREATE UNIQUE INDEX idx_scores_display_order
    ON scores(chart_score_id, display_order) WHERE display_order IS NOT NULL;
```

Keep a comment that current CHECK parity spans `0002_scores.sql + 0007_score_semantics.sql`; do not edit historical migration 0002.

- [ ] **Step 4: Mirror the current schema in Drizzle and shared row types**

Add to `chartScores`:

```ts
fullCombo: integer('full_combo').$type<0 | 1>().notNull().default(0),
maxCombo: integer('max_combo').notNull().default(0),
bestAchievementRate: real('best_achievement_rate'),
bestRankLabel: text('best_rank_label'),
lastPlayedAt: text('last_played_at'),
```

Add matching checks:

```ts
fullComboCheck: check('chart_scores_full_combo_check', sql`${table.fullCombo} IN (0, 1)`),
maxComboCheck: check('chart_scores_max_combo_check', sql`${table.maxCombo} >= 0`),
bestAchievementRateCheck: check(
	'chart_scores_best_achievement_rate_check',
	sql`${table.bestAchievementRate} IS NULL OR (${table.bestAchievementRate} >= 0 AND ${table.bestAchievementRate} <= 100)`
),
bestRankLabelCheck: check(
	'chart_scores_best_rank_label_check',
	sql`${table.bestRankLabel} IS NULL OR ${table.bestRankLabel} IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F')`
),
```

In `scores`, remove `fullCombo` / `maxCombo`, make `cleared` nullable, and add the cross-column best-row invariant:

```ts
cleared: integer('cleared').$type<0 | 1>(),
clearedCheck: check(
	'scores_cleared_check',
	sql`${table.cleared} IS NULL OR ${table.cleared} IN (0, 1)`
),
bestMetadataCheck: check(
	'scores_best_metadata_check',
	sql`${table.isBest} = 0 OR (${table.achievementRate} IS NULL AND ${table.rankLabel} IS NULL AND ${table.cleared} IS NULL AND ${table.performedAt} IS NULL AND ${table.displayOrder} IS NULL)`
),
```

Update `d1.types.ts`:

```ts
export interface ChartScoreRow {
	id: number;
	chart_id: number;
	user_id: string;
	play_count: number;
	clear_count: number;
	full_combo: 0 | 1;
	max_combo: number;
	best_achievement_rate: number | null;
	best_rank_label: string | null;
	last_played_at: string | null;
	created_at: string;
	updated_at: string;
}
```

Remove score-level `full_combo` / `max_combo`; keep `achievement_rate` / `rank_label` for recent rows and change `ScoreRow.cleared` to `0 | 1 | null`, `ScoreInsert.cleared` to `boolean | null | undefined`.

- [ ] **Step 5: Retarget CHECK parity to the current 0002 + 0007 contract**

In `db.test.ts`, keep the existing `propToColumn` entries for `fullCombo` and `maxCombo`; add only the genuinely new mappings:

```ts
bestAchievementRate: 'best_achievement_rate',
bestRankLabel: 'best_rank_label',
lastPlayedAt: 'last_played_at',
```

`lastPlayedAt` has no CHECK but keeping the mapping makes the parser complete.

Change `parseMigrationChecks` to return a `Set<string>` of normalized expressions rather than keying by the first token on each line. This is required because 0007 has multiple `ALTER TABLE ... ADD COLUMN ... CHECK` statements and a table-level CHECK.

For `chart_scores`, compare schema checks against:

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

For `scores`, compare against 0007's rebuilt table:

```ts
const scoresBlock = migration7.match(/CREATE TABLE scores_v2 \([\s\S]*?\);/)?.[0] ?? '';
const migrationChecks = parseMigrationChecks(scoresBlock);
```

The parser must capture **all** CHECK occurrences in the supplied SQL, including the table-level best metadata CHECK. Compare normalized expression sets exactly as the existing parity test does.

- [ ] **Step 6: Extend the existing atomic write without changing transaction structure**

Change `upsertChartScoreAndReplaceScores` parameters to:

```ts
params: {
	chartId: number;
	userId: string;
	playCount: number;
	clearCount: number;
	fullCombo: boolean;
	maxCombo: number;
	bestAchievementRate: number | null;
	bestRankLabel: string | null;
	lastPlayedAt: string | null;
	scores: ScoreInsert[];
}
```

Upsert the chart fields in the existing first D1 statement and remove `full_combo` / `max_combo` from score inserts.

Preserve tri-state clear when binding:

```ts
s.cleared == null ? null : s.cleared ? 1 : 0;
```

Do not use `s.cleared ? 1 : 0`; that destroys `null`.

- [ ] **Step 7: Update all common integration fixtures to the new current schema**

In `db.integration.test.ts`:

- update the migration-list assertion from `0001...0006` to include `0007_score_semantics.sql`;
- remove `full_combo` / `max_combo` from `scoreInput` and make `cleared` nullable;
- update every `upsertChartScoreAndReplaceScores` call with chart-level `fullCombo`, `maxCombo`, `bestAchievementRate`, `bestRankLabel`, and `lastPlayedAt`;
- update the hand-built TOCTOU `chart_scores` DDL with all new chart columns/checks;
- update the hand-built TOCTOU `scores` DDL to the rebuilt 0007 shape and best-row CHECK;
- keep the old-shape migration regression from Step 1 separate so it still proves the real transition.

Use this standard current-shape chart input in ordinary replacement tests:

```ts
{
	chartId: 1,
	userId: 'user-1',
	playCount: 7,
	clearCount: 4,
	fullCombo: true,
	maxCombo: 812,
	bestAchievementRate: 96.25,
	bestRankLabel: 'SS',
	lastPlayedAt: '2026-08-14T13:00:00Z',
	scores: [
		{
			is_best: true,
			score: 987654,
			achievement_rate: null,
			rank_label: null,
			cleared: null,
			perfect: 700,
			great: 80,
			good: 20,
			poor: 8,
			miss: 4,
			performed_at: null,
			display_order: null
		}
	]
}
```

Add one direct-DB assertion that an `is_best = 1` insert with non-null `achievement_rate`, `rank_label`, `cleared`, `performed_at`, or `display_order` fails the D1 CHECK.

- [ ] **Step 8: Run Task 1 tests**

```bash
bun run --filter=@dtx/common test
```

Expected: migration regression, CHECK parity, direct CHECK enforcement, atomic replace, readers, and TOCTOU coverage pass. Cross-package API/desktop/web typechecks may still fail because their contracts move in later tasks.

- [ ] **Step 9: Commit Task 1**

```bash
git add packages/dtx-api/d1-migrations/0007_score_semantics.sql \
  packages/common/src/lib/server/db/schema.ts \
  packages/common/src/lib/types/d1.types.ts \
  packages/common/src/lib/server/db.ts \
  packages/common/src/lib/server/db.test.ts \
  packages/common/src/lib/server/db.integration.test.ts
git commit -m "fix: separate chart score records"
```

---

## Task 2: Move the GraphQL/API contract to truthful ownership

**Files:**

- Modify: `packages/dtx-api/src/schema/score.ts`
- Test: `packages/dtx-api/src/schema/score.test.ts`
- Regenerate: `packages/dtx-api/dist/schema.graphql`

**Interfaces:**

- Consumes: Task 1 `ChartScoreRow` fields and updated atomic write parameters.
- Produces: `ChartScore.fullCombo/maxCombo/bestAchievementRate/bestRankLabel/lastPlayedAt`; nullable `Score.cleared`; best-row canonicalization; matching upload input.

- [ ] **Step 1: Update every API score fixture to the new ownership**

In `score.test.ts`, search the entire file for old score-level ownership:

```bash
rg "fullCombo|maxCombo|full_combo|max_combo|achievementRate|rankLabel|cleared|performedAt" \
  packages/dtx-api/src/schema/score.test.ts
```

Update every mocked `ChartScoreRow` to include:

```ts
full_combo: 1,
max_combo: 812,
best_achievement_rate: 96.25,
best_rank_label: 'SS',
last_played_at: '2026-08-14T13:00:00Z',
```

Update best `ScoreRow` fixtures so:

```ts
achievement_rate: null,
rank_label: null,
cleared: null,
performed_at: null,
display_order: null,
```

Keep recent rows' parsed rate/rank/result/time.

- [ ] **Step 2: Add failing canonicalization + chart-record coverage**

Use an upload chart whose best input deliberately carries stale metadata:

```ts
{
	chartId: String(chartId),
	playCount: 7,
	clearCount: 4,
	fullCombo: true,
	maxCombo: 812,
	bestAchievementRate: 96.25,
	bestRankLabel: 'SS',
	lastPlayedAt: '2026-08-14T13:00:00Z',
	scores: [
		{
			isBest: true,
			score: 987654,
			achievementRate: 72,
			rankLabel: 'B',
			cleared: true,
			performedAt: '2026-08-14T12:00:00Z',
			displayOrder: 5,
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

Assert the common write receives the chart records unchanged and the best score canonicalized to null rate/rank/result/time/order.

- [ ] **Step 3: Run the targeted API score suite and confirm it fails against the old schema**

```bash
bun run --filter=dtx-api test -- score.test.ts
```

Expected: GraphQL/type failures because the chart fields do not exist and `Score.cleared` is still non-null.

- [ ] **Step 4: Move fields between GraphQL object types**

Keep recent-capable fields on `ScoreRef`, remove only score-level `fullCombo` / `maxCombo`, and make clear nullable:

```ts
cleared: t.boolean({
	nullable: true,
	resolve: (s) => (s.cleared == null ? null : s.cleared === 1)
}),
```

Add to `ChartScoreRef`:

```ts
fullCombo: t.boolean({ resolve: (c) => c.chartScore.full_combo === 1 }),
maxCombo: t.int({ resolve: (c) => c.chartScore.max_combo }),
bestAchievementRate: t.float({
	nullable: true,
	resolve: (c) => c.chartScore.best_achievement_rate
}),
bestRankLabel: t.string({ nullable: true, resolve: (c) => c.chartScore.best_rank_label }),
lastPlayedAt: t.string({ nullable: true, resolve: (c) => c.chartScore.last_played_at }),
```

- [ ] **Step 5: Change input ownership and validation**

`ScoreInput` removes `fullCombo` / `maxCombo`; `cleared` remains optional/nullable. `achievementRate` / `rankLabel` remain because recent rows need them.

`ChartScoresInput` gains:

```ts
fullCombo: t.boolean({ required: true }),
maxCombo: t.int({ required: true }),
bestAchievementRate: t.float({ required: false }),
bestRankLabel: t.string({ required: false }),
lastPlayedAt: t.string({ required: false }),
```

Change `validateScoreFields` so judgments are the only count-like score fields:

```ts
const counts = [s.perfect, s.great, s.good, s.poor, s.miss];
```

Remove `s.maxCombo` from that array.

Extend `validateChartScores` with chart record validation:

```ts
if (!Number.isSafeInteger(maxCombo) || maxCombo < 0) {
	return { ok: false, reason: 'maxCombo must be a non-negative integer' };
}
if (
	bestAchievementRate != null &&
	(!Number.isFinite(bestAchievementRate) || bestAchievementRate < 0 || bestAchievementRate > 100)
) {
	return { ok: false, reason: 'bestAchievementRate out of range' };
}
```

Derive `bestRankLabel` exclusively from the validated `bestAchievementRate` using a server-side `deriveRankLabel` function (thresholds: SS >= 95, S >= 80, A >= 73, B >= 63, C >= 53, D >= 45, E < 45, matching DTXManiaCX `ComputeRank` and the desktop `derive_rank_label`). The client-supplied `bestRankLabel` is ignored; return `null` when no rate exists. Validate `lastPlayedAt` with `Date.parse`; reject an unparseable value and clamp a future value to the Worker's `Date.now()` using the same policy already used for recent `performedAt`.

- [ ] **Step 6: Canonicalize best rows at the existing normalization seam**

At the start of the per-score loop:

```ts
for (const s of scores) {
	let row: InputScore = s.isBest
		? {
				...s,
				achievementRate: null,
				rankLabel: null,
				cleared: null,
				performedAt: null,
				displayOrder: null
			}
		: s;

	// existing recent rank sanitization / timestamp clamp / field validation
}
```

Do not add a second canonicalization function or compatibility path.

- [ ] **Step 7: Pass chart records into the common atomic write**

Call:

```ts
await upsertChartScoreAndReplaceScores(ctx.env.DB, {
	chartId,
	userId: ctx.user.id,
	playCount: chart.playCount,
	clearCount: chart.clearCount,
	fullCombo: chart.fullCombo,
	maxCombo: chart.maxCombo,
	bestAchievementRate: chart.bestAchievementRate ?? null,
	bestRankLabel: derivedBestRankLabel,
	lastPlayedAt: normalizedLastPlayedAt,
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

Keep rate limiting, concurrency, visibility checks, and response envelopes unchanged.

- [ ] **Step 8: Run API tests/check and regenerate the committed schema**

```bash
bun run --filter=dtx-api test
bun run --filter=dtx-api check
bun run --filter=dtx-api gen-schema
```

Verify `packages/dtx-api/dist/schema.graphql` exposes:

```graphql
type ChartScore {
	fullCombo: Boolean!
	maxCombo: Int!
	bestAchievementRate: Float
	bestRankLabel: String
	lastPlayedAt: String
}

type Score {
	cleared: Boolean
}
```

and that `ChartScoresInput` owns the chart records.

- [ ] **Step 9: Commit Task 2**

```bash
git add packages/dtx-api/src/schema/score.ts \
  packages/dtx-api/src/schema/score.test.ts \
  packages/dtx-api/dist/schema.graphql
git commit -m "fix: expose truthful score contract"
```

Task-local API checks pass here; desktop/web generated clients are still expected to be red until Tasks 3–4.

---

## Task 3: Correct desktop parsing, upload payloads, and local preview

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
- Produces: parsed `ChartAggregate` with all chart records and sparse best/recent `ScorePayload` rows.

- [ ] **Step 1: Update the existing Rust parser regression fixture**

In `parse_maps_best_recent_and_ignores_non_drums`, use deliberately distinct source facts:

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

Assert ownership:

```rust
let chart = &songs[0].charts[0];
assert_eq!(chart.aggregate.play_count, 7);
assert_eq!(chart.aggregate.clear_count, 4);
assert!(chart.aggregate.full_combo);
assert_eq!(chart.aggregate.max_combo, 812);
assert_eq!(chart.aggregate.best_achievement_rate, Some(96.25));
assert_eq!(chart.aggregate.best_rank_label.as_deref(), Some("SS"));
assert_eq!(
    chart.aggregate.last_played_at.as_deref(),
    Some("2026-08-14T13:00:00Z")
);

let best = chart.best.as_ref().unwrap();
assert_eq!(best.score, Some(987654));
assert_eq!(best.achievement_rate, None);
assert_eq!(best.rank_label, None);
assert_eq!(best.cleared, None);
assert_eq!(best.performed_at, None);
assert_eq!(best.perfect, Some(700));
```

Update the malformed recent-history assertion that currently treats parser failure as `false`; it must assert `None`.

- [ ] **Step 2: Run targeted Rust score tests and confirm the old output fails**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml scores
```

Expected: failures because `ChartAggregate` lacks fields and `build_best` still carries mixed metadata.

- [ ] **Step 3: Extend `ChartAggregate` and narrow best construction**

Keep `ScorePayload.achievement_rate` / `rank_label` because recent rows need them, but make the best row set them to `None`.

Extend `ChartAggregate`:

```rust
pub struct ChartAggregate {
    pub play_count: i64,
    pub clear_count: i64,
    pub full_combo: bool,
    pub max_combo: i64,
    pub best_achievement_rate: Option<f64>,
    pub best_rank_label: Option<String>,
    pub last_played_at: Option<String>,
}
```

`build_best` becomes:

```rust
Some(ScorePayload {
    is_best: true,
    score: Some(score.best_score),
    achievement_rate: None,
    rank_label: None,
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

Do not match `PerformanceHistory` to infer best metadata.

- [ ] **Step 4: Build chart records from `DrumsScoreRow` and preserve tri-state recent result**

At chart creation:

```rust
let best_achievement_rate = Some(row.score.best_achievement_rate)
    .filter(|value| value.is_finite() && *value >= 0.0 && *value <= 100.0);
let best_rank_label = best_achievement_rate.map(|rate| derive_rank_label(rate).to_string());

aggregate: ChartAggregate {
    play_count: row.score.play_count,
    clear_count: row.score.clear_count,
    full_combo: row.score.full_combo != 0,
    max_combo: row.score.max_combo,
    best_achievement_rate,
    best_rank_label,
    last_played_at: row.score.last_played_at.clone(),
},
```

Replace:

```rust
cleared: parsed.cleared.unwrap_or(false),
```

with:

```rust
cleared: parsed.cleared,
```

Keep the current `derive_rank_label` tests; the helper now serves chart-level best achievement instead of best `Score` construction.

- [ ] **Step 5: Update renderer types and all `Scores.test.ts` fixtures**

`LocalChartData.aggregate` becomes:

```ts
aggregate: {
	playCount: number;
	clearCount: number;
	fullCombo: boolean;
	maxCombo: number;
	bestAchievementRate: number | null;
	bestRankLabel: string | null;
	lastPlayedAt: string | null;
}
```

Best `ScorePayload` fixtures use:

```ts
achievementRate: null,
rankLabel: null,
cleared: null,
performedAt: null,
```

Recent rows retain their history rate/rank/time.

Move the chart records into the parsed chart fixture:

```ts
aggregate: {
	playCount: 7,
	clearCount: 5,
	fullCombo: true,
	maxCombo: 800,
	bestAchievementRate: 75,
	bestRankLabel: 'A',
	lastPlayedAt: '2026-06-02T00:00:00Z'
}
```

- [ ] **Step 6: Update `Scores.svelte::buildUpload`**

Extend the chart payload and push:

```ts
charts.push({
	chartId,
	playCount: chart.aggregate.playCount,
	clearCount: chart.aggregate.clearCount,
	fullCombo: chart.aggregate.fullCombo,
	maxCombo: chart.aggregate.maxCombo,
	bestAchievementRate: chart.aggregate.bestAchievementRate,
	bestRankLabel: chart.aggregate.bestRankLabel,
	lastPlayedAt: chart.aggregate.lastPlayedAt,
	scores
});
```

Update `Scores.test.ts` upload expectations accordingly. Do not change adaptive batching, link restore, duplicate-match behavior, or skip-reason plumbing. Old installed desktop builds are intentionally not supported after the API cutover.

- [ ] **Step 7: Keep chart records visually separate from the best-score row**

In `ScoreChartRow.svelte`, `bestParts` must contain only the numeric score and must not pull rate/rank/max-combo/full-combo from `best`.

Render chart records in the existing chart summary area:

```svelte
{#if chart.aggregate.bestRankLabel}
	<span class="text-amber-300">{chart.aggregate.bestRankLabel}</span>
{/if}
{#if chart.aggregate.bestAchievementRate != null}
	<span class="text-cyan">{chart.aggregate.bestAchievementRate}%</span>
{/if}
<span class="text-dim">{$_('score.combo')} {chart.aggregate.maxCombo}</span>
{#if chart.aggregate.fullCombo}
	<span class="text-green">{$_('score.full_combo')}</span>
{/if}
```

Do not combine those fields into one text fragment prefixed as the best-score performance.

Render recent result state explicitly:

```svelte
{#if recent.cleared === true}
	<span class="text-green-300">{$_('score.cleared')}</span>
{:else if recent.cleared === false}
	<span class="text-red-300">{$_('score.failed')}</span>
{:else}
	<span class="text-faint">—</span>
{/if}
```

`lastPlayedAt` remains in the aggregate contract; no new local preview copy is added in HPA-308.

- [ ] **Step 8: Update `ScoreChartRow.test.ts` for separated ownership**

Use a chart with all chart records and assert:

- best score renders from `best.score`;
- chart-level best achievement/rank render outside the best-score parts;
- max combo/full combo render once at chart level;
- best fixture has null rate/rank/result/time;
- recent true/false/null results render Cleared/Failed/dash.

Keep the existing separator assertions so removing best-row segments does not leave doubled separators.

- [ ] **Step 9: Run native + renderer gates**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
```

Expected: Rust parser tests, `Scores.test.ts`, `ScoreChartRow.test.ts`, and desktop typecheck pass. Web generated types may still be red until Task 4.

- [ ] **Step 10: Commit Task 3**

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

## Task 4: Update web query, adapter, presentation, and the existing score E2E flow

**Files:**

- Modify: `packages/dtx-web/src/lib/api/operations/score.graphql`
- Regenerate: `packages/dtx-web/src/lib/api/generated/graphql.ts`
- Modify: `packages/dtx-web/src/lib/api/score.ts`
- Test: `packages/dtx-web/src/lib/api/score.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ScoreCard.svelte`
- Test: `packages/dtx-web/src/lib/components/ScoreCard.test.ts`
- Test: `packages/dtx-web/src/routes/(app)/app/score/score-page.test.ts`
- Test: `packages/e2e-web/score.spec.ts`

**Interfaces:**

- Consumes: committed Task 2 API schema.
- Produces: web `ChartScoreView` ownership matching the API and an updated existing Playwright round trip.

- [ ] **Step 1: Change the GraphQL operation**

Inside `myChartScore`, request:

```graphql
playCount
clearCount
fullCombo
maxCombo
bestAchievementRate
bestRankLabel
lastPlayedAt
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

Remove score-level `fullCombo` / `maxCombo` selections.

- [ ] **Step 2: Regenerate in dependency order**

```bash
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
```

Expected: web generated types expose the chart records and nullable `Score.cleared`.

- [ ] **Step 3: Update web adapter types and tests**

`ChartScoreView` becomes:

```ts
export type ChartScoreView = {
	playCount: number;
	clearCount: number;
	fullCombo: boolean;
	maxCombo: number;
	bestAchievementRate: number | null;
	bestRankLabel: string | null;
	lastPlayedAt: string | null;
	best: ScoreView | null;
	recent: ScoreView[];
};
```

`ScoreView` drops `fullCombo` / `maxCombo` and changes `cleared` to `boolean | null`; it keeps nullable `achievementRate` / `rankLabel` because recent rows use them.

In `toChartScoreView` map:

```ts
fullCombo: cs.fullCombo,
maxCombo: cs.maxCombo,
bestAchievementRate: cs.bestAchievementRate,
bestRankLabel: cs.bestRankLabel,
lastPlayedAt: cs.lastPlayedAt,
```

Use a `score.test.ts` fixture where best score rate/rank/result/time are null and chart records carry `96.25`, `SS`, and the latest timestamp.

- [ ] **Step 4: Update `score-page.test.ts` typed fixture**

Move all chart records onto `chartScore`:

```ts
chartScore: {
	playCount: 5,
	clearCount: 2,
	fullCombo: false,
	maxCombo: 800,
	bestAchievementRate: 90,
	bestRankLabel: 'S',
	lastPlayedAt: '2026-08-14T13:00:00Z',
	best: {
		id: 1,
		isBest: true,
		score: 900000,
		achievementRate: null,
		rankLabel: null,
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

Do not add new page behavior.

- [ ] **Step 5: Separate chart records from the best-score presentation**

In `ScoreCard.svelte`:

- render `bestAchievementRate` / `bestRankLabel`, `maxCombo`, and `fullCombo` from `chart.chartScore` in the chart summary;
- keep the best block to `best.score` and judgment counts;
- do not render chart best achievement/rank as if they belong to the same performance as `best.score`;
- keep `lastPlayedAt` in the view model without adding new copy in this ticket;
- render recent `cleared: null` as a neutral dash.

No new translation key is required.

- [ ] **Step 6: Update `ScoreCard.test.ts`**

Pin:

1. chart best achievement/rank render from `ChartScore`;
2. chart max combo/full combo render once;
3. best score/judgments render with null rate/rank/result/time;
4. recent clear true/false/null render Cleared/Failed/dash.

- [ ] **Step 7: Update the existing Playwright score payload/query**

Move records to the chart input in `ROUND_TRIP_PAYLOAD` and `scorePagePayload`:

```ts
{
	chartId,
	playCount: 12,
	clearCount: 8,
	fullCombo: true,
	maxCombo: 432,
	bestAchievementRate: 98.34,
	bestRankLabel: 'SS',
	lastPlayedAt: '2025-06-01T10:00:00Z',
	scores: [
		{
			isBest: true,
			score: 983400,
			achievementRate: null,
			rankLabel: null,
			cleared: null,
			perfect: 210,
			great: 180,
			good: 30,
			poor: 12,
			miss: 8,
			performedAt: null,
			displayOrder: null
		},
		// existing recent rows, without score-level fullCombo/maxCombo
	]
}
```

Change the E2E query/type to select the five chart-level records and keep recent score fields.

Assert:

```ts
expect(chartScore.fullCombo).toBe(true);
expect(chartScore.maxCombo).toBe(432);
expect(chartScore.bestAchievementRate).toBeCloseTo(98.34, 2);
expect(chartScore.bestRankLabel).toBe('SS');
expect(chartScore.lastPlayedAt).toBe('2025-06-01T10:00:00Z');
expect(bestScore!.achievementRate).toBeNull();
expect(bestScore!.rankLabel).toBeNull();
expect(bestScore!.cleared).toBeNull();
```

Keep the existing upload round-trip and `/app/score` UI scenarios; do not create another E2E test.

- [ ] **Step 8: Run Task 4 tests/codegen gates**

```bash
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-web lint:codegen
bun run --filter=dtx-e2e-web check
```

Expected: web units, page fixture, generated client, and E2E TypeScript checks pass. At this point the full cross-package type contract should be coherent.

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

## Task 5: Run the complete existing regression gate

**Files:**

- No planned changes; fix failures in the task that owns the boundary.

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces: one green breaking contract ready for deployment.

- [ ] **Step 1: Check the one semantic coercion the compiler cannot catch**

```bash
rg "unwrap_or\(false\)" packages/dtx-desktop/src-tauri/src/scores.rs
```

Expected: no match on the score-history result path.

- [ ] **Step 2: Verify generated artifacts**

```bash
bun run --filter=dtx-api gen-schema
git diff --exit-code -- packages/dtx-api/dist/schema.graphql
bun run --filter=dtx-web lint:codegen
```

Expected: no API schema or web client drift.

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

Expected: all pass.

- [ ] **Step 4: Run the existing score E2E spec**

```bash
bun run --filter=dtx-e2e-web e2e -- score.spec.ts
```

Expected: existing score upload round-trip and `/app/score` scenarios pass under the new chart-record contract.

- [ ] **Step 5: Run diff hygiene**

```bash
git diff --check main...HEAD
```

Expected: no whitespace errors.

---

## Task 6: Deploy the breaking contract in dependency order

**Files:**

- No source changes. This is the release sequence after Task 5 is green and the implementation PR is approved/merged.

**Interfaces:**

- Consumes: merged implementation on `main`.
- Produces: migrated API, matching web bundle, then updated desktop clients.

- [ ] **Step 1: Deploy preproduction API first**

```bash
bun run deploy:api:preprod
```

This command already runs `migrate:preprod` before `wrangler deploy`, so D1 0007 lands before the narrowed API schema.

Expected: migration 0007 and `dtx-api-pre-prod` deploy succeed.

- [ ] **Step 2: Deploy preproduction web immediately**

```bash
bun run deploy:web:preprod
```

Expected: `https://pre-prod.dtx.hapadona.com` serves the web bundle generated against the new API schema.

The short API→web interval is intentionally breaking; do not add a compatibility schema just to hide this deployment window.

- [ ] **Step 3: Smoke the preproduction score flow**

Using an authenticated preproduction account:

1. Open `https://pre-prod.dtx.hapadona.com/app/score`.
2. Confirm the page loads without GraphQL validation errors.
3. Upload a score from a desktop build containing the HPA-308 changes and pointed at preproduction.
4. Confirm the chart shows best achievement/rank, max combo, and full-combo at chart level; the best score remains separate; recent rows still show result/time.

Do not proceed to production if the old score fields appear in a GraphQL validation error.

- [ ] **Step 4: Deploy production API, then production web immediately**

```bash
bun run deploy:api
bun run deploy:web
```

`deploy:api` applies the production D1 migration before Worker deployment. Run `deploy:web` immediately afterward because the old deployed web document selects `Score.fullCombo/maxCombo` and will fail against the narrowed API during this window.

Expected: both commands succeed.

- [ ] **Step 5: Verify production web query health**

Open:

```text
https://dtx.hapadona.com/app/score
```

with an authenticated account and confirm the score page loads without GraphQL validation errors.

- [ ] **Step 6: Release the updated desktop client last**

Current committed desktop version is `1.0.0`; trigger the existing signed updater workflow with the next patch version:

```bash
gh workflow run desktop-build-deploy.yml --ref main -f version=1.0.1
```

Then verify the workflow succeeds:

```bash
gh run list --workflow=desktop-build-deploy.yml --limit 1
```

Expected: the latest run completes successfully and publishes signed updater artifacts / `latest.json`.

Existing installed 1.0.0 clients may receive a whole-mutation GraphQL validation error if they upload during the API→desktop-update interval because they do not send the new chart-level inputs. This is an accepted consequence of the deliberate no-compatibility decision; do not add a legacy mutation or skip-reason translation for it.

## Plan self-review

- **Source semantics:** modern DTXManiaCX writes `BestScore + BestPerfect...BestMiss` under the score comparison, but `BestAchievementRate` under the separate best-skill comparison; `LastPlayedAt` is latest-play data. The plan no longer treats them as one performance.
- **Migration coverage:** one real-D1 test applies 0001–0006, seeds old score-level records, applies 0007, checks all five chart-record backfills, best-row nulling, ID preservation, and sequence preservation.
- **Invariant coverage:** API canonicalization and a D1/Drizzle table CHECK both require best rate/rank/result/time/order to be null.
- **Parity coverage:** `db.test.ts` compares current `chart_scores` checks from 0002+0007 and rebuilt `scores` checks from 0007; the parser handles ALTER/table-level checks without first-token collisions.
- **Fixture coverage:** common DB tests, API `score.test.ts`, Rust `scores_tests.rs`, desktop `Scores.test.ts` / `ScoreChartRow.test.ts`, web adapter/component/page tests, and existing `e2e-web/score.spec.ts` all follow the same ownership.
- **Generated-file coverage:** API schema is regenerated/committed before web client codegen.
- **Command accuracy:** desktop uses `typecheck`; API uses `gen-schema`; existing Playwright score spec is run; deployment uses existing root scripts and updater workflow.
- **Commit-state clarity:** Tasks 1–3 can be cross-package red by design; the full tree is required green after Task 4 and in Task 5.
- **Deployment coverage:** preprod API→web→smoke, then prod API→web, then desktop updater release. No compatibility layer is introduced for the short breaking windows.
- **Scope:** no new table, evaluator, registry, history model, versioned input, compatibility path, or extra E2E scenario.
- **Placeholder scan:** no `TBD`, `TODO`, unnamed implementation step, or generic “add tests” remains.
