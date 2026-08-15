# HPA-308 Score Import Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make imported score data truthful by keeping coherent best-score statistics on the best row, moving cumulative full-combo/max-combo values to chart aggregates, and representing unknown per-play clear results as unknown.

**Architecture:** Keep the existing `ChartScore` + `Score` model and its atomic replace-all upload path. Extend `ChartScore` with the two aggregate fields already sourced from `SongScores`, narrow `Score` to play/stat-block fields, and carry the same ownership through D1, GraphQL, desktop parsing/upload, and web rendering. Do not introduce a compatibility layer or a second score representation.

**Tech Stack:** Cloudflare D1 / SQLite migrations, TypeScript, Drizzle schema definitions, Pothos GraphQL, Svelte 5, Rust + rusqlite/Tauri, Vitest, Cargo tests, GraphQL Code Generator.

## Global Constraints

- Keep `chart_scores` as the sole per-user chart aggregate and `scores` as best/recent score rows; do not add a new domain table.
- Preserve the existing atomic `upsert chart_scores -> delete scores -> insert replacement scores` D1 batch.
- Preserve exactly one best row and at most five recent rows per uploaded chart.
- Best row may contain only `BestScore`, `BestAchievementRate`, derived rank, and the `BestPerfect/BestGreat/BestGood/BestPoor/BestMiss` stat block; its `cleared`, `performedAt`, and `displayOrder` are `null`.
- `fullCombo` means “this chart has ever been full-comboed” and belongs on `ChartScore`.
- `maxCombo` means the all-time maximum combo and belongs on `ChartScore`; store it as a non-negative integer with default `0`.
- Recent `cleared` is tri-state: `true`, `false`, or `null` when `HistoryLine` cannot determine the result.
- Remove `fullCombo` and `maxCombo` from the `Score` persistence/API/client shape instead of keeping aliases or deprecated fields.
- Do not version the GraphQL mutation or preserve the old upload shape; there are no compatibility requirements for this breaking change.
- Do not change chart matching, upload batching, score pagination, authentication, or navigation.
- Do not add a new E2E scenario unless an existing score E2E fixture cannot be updated to the new contract with a local fixture change.

---

### Task 1: Move aggregate ownership into the D1/common contract

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

- [ ] **Step 1: Add a failing common DB test for aggregate ownership and nullable score result**

Add a focused replacement test alongside the existing `upsertChartScoreAndReplaceScores` coverage. The important assertions are that aggregate fields round-trip through `chart_scores`, the best score carries `cleared = null`, and a recent score can also carry an unknown result:

```ts
const replaced = await upsertChartScoreAndReplaceScores(db, {
	chartId,
	userId: 'user-1',
	playCount: 7,
	clearCount: 4,
	fullCombo: true,
	maxCombo: 812,
	scores: [
		{
			is_best: true,
			score: 987654,
			achievement_rate: 96.25,
			rank_label: 'SS',
			cleared: null,
			perfect: 700,
			great: 80,
			good: 20,
			poor: 8,
			miss: 4,
			performed_at: null,
			display_order: null
		},
		{
			is_best: false,
			achievement_rate: 81.5,
			rank_label: 'S',
			cleared: null,
			performed_at: '2026-08-14T12:00:00Z',
			display_order: 1
		}
	]
});

expect(replaced.full_combo).toBe(1);
expect(replaced.max_combo).toBe(812);

const stored = await getUserChartScore(db, 'user-1', chartId);
expect(stored?.scores[0]?.cleared).toBeNull();
expect(stored?.scores[1]?.cleared).toBeNull();
```

Also update any existing test fixtures that construct `ChartScoreRow` / `ScoreRow` directly so TypeScript compilation exposes every old `full_combo` / `max_combo` score dependency.

- [ ] **Step 2: Run the targeted common test and confirm it fails on the old contract**

Run:

```bash
bun run --filter=@dtx/common test -- db.test.ts
```

Expected: failure/type errors because `ChartScoreRow` and the upsert input do not yet expose `full_combo` / `max_combo`, while `ScoreInsert.cleared` does not accept `null`.

- [ ] **Step 3: Add migration `0007_score_semantics.sql`**

Implement the migration as a forward cleanup that preserves trustworthy existing data:

```sql
ALTER TABLE chart_scores
    ADD COLUMN full_combo INTEGER NOT NULL DEFAULT 0
    CHECK (full_combo IN (0, 1));

ALTER TABLE chart_scores
    ADD COLUMN max_combo INTEGER NOT NULL DEFAULT 0
    CHECK (max_combo >= 0);

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

Retain the migration header explaining the same dual-source-of-truth rule used by `0002_scores.sql`: the CHECK constraints must match `schema.ts`.

- [ ] **Step 4: Mirror the migration in Drizzle and shared row types**

Update `chartScores` in `schema.ts`:

```ts
fullCombo: integer('full_combo').$type<0 | 1>().notNull().default(0),
maxCombo: integer('max_combo').notNull().default(0),
```

Add matching checks:

```ts
fullComboCheck: check('chart_scores_full_combo_check', sql`${table.fullCombo} IN (0, 1)`),
maxComboCheck: check('chart_scores_max_combo_check', sql`${table.maxCombo} >= 0`),
```

Remove `fullCombo` / `maxCombo` from `scores`, and change the score clear check to:

```ts
cleared: integer('cleared').$type<0 | 1>(),
clearedCheck: check(
	'scores_cleared_check',
	sql`${table.cleared} IS NULL OR ${table.cleared} IN (0, 1)`
),
```

Update `d1.types.ts` to the exact persisted shape:

```ts
export interface ChartScoreRow {
	id: number;
	chart_id: number;
	user_id: string;
	play_count: number;
	clear_count: number;
	full_combo: 0 | 1;
	max_combo: number;
	created_at: string;
	updated_at: string;
}

export interface ScoreRow {
	// existing fields
	cleared: 0 | 1 | null;
	// no full_combo or max_combo
}

export interface ScoreInsert {
	// existing fields
	cleared?: boolean | null;
	// no full_combo or max_combo
}
```

- [ ] **Step 5: Extend the atomic upsert and narrow score inserts**

Change the function parameter contract in `db.ts`:

```ts
params: {
	chartId: number;
	userId: string;
	playCount: number;
	clearCount: number;
	fullCombo: boolean;
	maxCombo: number;
	scores: ScoreInsert[];
}
```

The `chart_scores` statement becomes:

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

Bind `fullCombo ? 1 : 0` and `maxCombo` with the existing fields. Remove `full_combo` and `max_combo` from the `INSERT INTO scores` column list/binds; bind nullable clear state explicitly:

```ts
s.cleared == null ? null : s.cleared ? 1 : 0
```

Do not change the visibility subquery, transaction structure, delete behavior, or result handling.

- [ ] **Step 6: Update migration/schema parity and replacement tests**

Update existing `db.test.ts` schema parity assertions so they expect the new chart checks and nullable score clear check, and no longer expect score-level full-combo/max-combo checks.

In `db.integration.test.ts`, extend the existing insert -> replace -> replace scenario rather than creating a new harness. On the final replacement assert:

```ts
expect(result.chartScore.full_combo).toBe(1);
expect(result.chartScore.max_combo).toBe(812);
expect(result.scores.find((s) => s.is_best === 1)?.cleared).toBeNull();
```

- [ ] **Step 7: Run common tests**

Run:

```bash
bun run --filter=@dtx/common test
```

Expected: all common tests pass, including migration parity and D1 replacement coverage.

- [ ] **Step 8: Commit Task 1**

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

### Task 2: Make the GraphQL contract enforce truthful score semantics

**Files:**
- Modify: `packages/dtx-api/src/schema/score.ts`
- Test: `packages/dtx-api/src/schema/score.test.ts`

**Interfaces:**
- Consumes: Task 1 `ChartScoreRow.full_combo/max_combo` and updated `upsertChartScoreAndReplaceScores` input.
- Produces: `ChartScore.fullCombo: Boolean!`, `ChartScore.maxCombo: Int!`, `Score.cleared: Boolean`, and upload input with chart-level aggregate fields.

- [ ] **Step 1: Write failing API tests for the new ownership**

Update an upload mutation fixture so one chart sends:

```ts
{
	chartId: String(chartId),
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

After upload, query `myChartScore` and assert:

```ts
expect(chartScore.fullCombo).toBe(true);
expect(chartScore.maxCombo).toBe(812);
expect(best.cleared).toBeNull();
expect(best.performedAt).toBeNull();
expect(recent.cleared).toBeNull();
```

The intentionally stale `cleared: true` / `performedAt` on the best input pins server canonicalization instead of trusting the desktop client.

- [ ] **Step 2: Run the API score test and verify the contract fails before implementation**

Run:

```bash
bun run --filter=dtx-api test -- score.test.ts
```

Expected: GraphQL input/query errors for missing chart aggregate fields and nullable clear semantics.

- [ ] **Step 3: Move aggregate fields from `ScoreRef` to `ChartScoreRef`**

Remove score-level resolvers for `fullCombo` and `maxCombo`.

Make `cleared` nullable:

```ts
cleared: t.boolean({
	nullable: true,
	resolve: (s) => (s.cleared == null ? null : s.cleared === 1)
}),
```

Add chart-level resolvers:

```ts
fullCombo: t.boolean({ resolve: (c) => c.chartScore.full_combo === 1 }),
maxCombo: t.int({ resolve: (c) => c.chartScore.max_combo }),
```

- [ ] **Step 4: Change the upload input and validation types**

`ScoreInput` removes `fullCombo` and `maxCombo`, and makes clear state optional/nullable:

```ts
cleared: t.boolean({ required: false }),
```

`ChartScoresInput` gains:

```ts
fullCombo: t.boolean({ required: true }),
maxCombo: t.int({ required: true }),
```

Update `InputScore`:

```ts
cleared?: boolean | null;
```

Do not add a second input type or compatibility alias.

- [ ] **Step 5: Validate chart aggregates and canonicalize the best row**

Extend `validateChartScores` parameters with `fullCombo` and `maxCombo`. `fullCombo` already arrives as a GraphQL Boolean; validate `maxCombo` with:

```ts
if (!Number.isSafeInteger(maxCombo) || maxCombo < 0) {
	return { ok: false, reason: 'maxCombo must be a non-negative integer' };
}
```

Before per-row field validation, canonicalize every best row:

```ts
if (row.isBest) {
	row = {
		...row,
		cleared: null,
		performedAt: null,
		displayOrder: null
	};
}
```

Keep the existing exactly-one-best rule, recent count cap, rank sanitization, future-date clamping for **recent** rows, and chart-level failure behavior.

- [ ] **Step 6: Pass chart aggregates into the common DB write**

When the mutation invokes `upsertChartScoreAndReplaceScores`, include:

```ts
fullCombo: chart.fullCombo,
maxCombo: chart.maxCombo,
```

Map nullable clear state without coercing `null` to false:

```ts
cleared: score.cleared ?? null,
```

Do not change rate limiting, visibility batching, write concurrency, or skip/result envelopes.

- [ ] **Step 7: Update skip-reason tests only where validation text changed**

If the new `maxCombo` validation is surfaced in existing skip tests, pin the exact string:

```text
maxCombo must be a non-negative integer
```

Do not add client-facing localization here; desktop maps raw server reasons in Task 3.

- [ ] **Step 8: Run API tests**

Run:

```bash
bun run --filter=dtx-api test
```

Expected: all API schema/auth/rate-limit tests pass under the breaking upload contract.

- [ ] **Step 9: Commit Task 2**

```bash
git add packages/dtx-api/src/schema/score.ts packages/dtx-api/src/schema/score.test.ts
git commit -m "fix: expose truthful score contract"
```

---

### Task 3: Correct desktop parsing, upload payloads, and local score preview

**Files:**
- Modify: `packages/dtx-desktop/src-tauri/src/scores.rs`
- Test: `packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs`
- Modify: `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/ScoreChartRow.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/ScoreChartRow.test.ts`
- Test: existing `Scores.svelte` tests if present in `packages/dtx-desktop/src/renderer/src/components/`
- Modify: score skip i18n resources only if an existing `Scores` test requires a friendly mapping for the new `maxCombo` validation string.

**Interfaces:**
- Consumes: Task 2 chart-level upload contract.
- Produces: parsed desktop charts with `{ playCount, clearCount, fullCombo, maxCombo }` aggregates and score rows whose `cleared` is `boolean | null`.

- [ ] **Step 1: Add Rust regression coverage for the mixed-best bug**

Extend `scores_tests.rs` with a fixture where the source values visibly disagree:

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

Assert the parsed chart shape:

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

Also update the garbage-history test to assert:

```rust
assert_eq!(parsed.cleared, None);
```

and an end-to-end joined-row fixture to prove an unparseable history line produces a recent payload with `cleared == None` rather than `false`.

- [ ] **Step 2: Run the targeted Rust score tests and verify they fail**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml scores
```

Expected: failures because `ChartAggregate` lacks the fields and best/recent clear state is still forced to `bool`.

- [ ] **Step 3: Narrow `ScorePayload` and extend `ChartAggregate`**

Change the Rust structs to:

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

Keep `DrumsScoreRow.full_combo`, `.max_combo`, `.last_played_at` because the joined SQLite query still needs to read those source fields. The ownership change happens when building the output, not when reading DTXManiaCX.

- [ ] **Step 4: Make `build_best` use only coherent best-score fields**

Construct the best payload as:

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

Do not try to match `BestScore` to `PerformanceHistory`; that table does not contain the required score/stat block.

- [ ] **Step 5: Build chart aggregates and preserve unknown history results**

When starting each `DtxmaniaChart`, construct:

```rust
aggregate: ChartAggregate {
    play_count: row.score.play_count,
    clear_count: row.score.clear_count,
    full_combo: row.score.full_combo != 0,
    max_combo: row.score.max_combo,
},
```

For recent rows, replace:

```rust
cleared: parsed.cleared.unwrap_or(false),
```

with:

```rust
cleared: parsed.cleared,
```

Remove score-level `full_combo` / `max_combo` construction from both best and recent payloads.

- [ ] **Step 6: Run Rust tests**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
```

Expected: all native unit tests pass.

- [ ] **Step 7: Update renderer score types**

Change `ScorePayload` in `scoreTypes.ts`:

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

Change `LocalChartData.aggregate` to:

```ts
aggregate: {
	playCount: number;
	clearCount: number;
	fullCombo: boolean;
	maxCombo: number;
};
```

- [ ] **Step 8: Send aggregate fields in `Scores.svelte::buildUpload`**

Change the local chart upload type and pushed payload to include:

```ts
fullCombo: chart.aggregate.fullCombo,
maxCombo: chart.aggregate.maxCombo,
```

The payload remains:

```ts
{
	chartId,
	playCount: chart.aggregate.playCount,
	clearCount: chart.aggregate.clearCount,
	fullCombo: chart.aggregate.fullCombo,
	maxCombo: chart.aggregate.maxCombo,
	scores
}
```

Do not change batching, link restoration, duplicate-chart detection, or partial-progress behavior.

If `humanizeSkipReason` has tests that require every validation error to be friendly, add exactly:

```ts
'maxCombo must be a non-negative integer': 'score.skip.invalid_max_combo'
```

plus the corresponding translation key in the existing locales. Otherwise leave unknown-reason fallback behavior unchanged and avoid new copy.

- [ ] **Step 9: Move max/full-combo display to the chart summary**

In `ScoreChartRow.svelte`, remove from `bestParts`:

```ts
if (best.maxCombo != null) ...
if (best.fullCombo) ...
```

Render the aggregate facts beside the existing play/clear text:

```svelte
<span class="text-dim">
	{$_('score.combo')} {chart.aggregate.maxCombo}
</span>
{#if chart.aggregate.fullCombo}
	<span class="text-green">{$_('score.full_combo')}</span>
{/if}
```

For recent outcomes, use explicit tri-state rendering:

```svelte
{#if recent.cleared === true}
	<span class="text-green-300">{$_('score.cleared')}</span>
{:else if recent.cleared === false}
	<span class="text-red-300">{$_('score.failed')}</span>
{:else}
	<span class="text-faint">—</span>
{/if}
```

- [ ] **Step 10: Update renderer tests**

In `ScoreChartRow.test.ts`, create one chart whose best score has no aggregate properties and whose chart aggregate has `fullCombo: true`, `maxCombo: 812`. Assert the full-combo/max-combo labels still render once at chart level.

Add recent rows with `cleared: true`, `false`, and `null` and assert the unknown row does not render either the Cleared or Failed label.

Update any `Scores` payload test to expect `fullCombo` / `maxCombo` at chart level and no such keys inside `scores`.

- [ ] **Step 11: Run desktop tests and checks**

Run:

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop check
```

Expected: renderer/unit tests and Svelte/TypeScript checks pass.

- [ ] **Step 12: Commit Task 3**

```bash
git add packages/dtx-desktop/src-tauri/src/scores.rs \
  packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs \
  packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts \
  packages/dtx-desktop/src/renderer/src/components/Scores.svelte \
  packages/dtx-desktop/src/renderer/src/components/ScoreChartRow.svelte \
  packages/dtx-desktop/src/renderer/src/components/ScoreChartRow.test.ts
git commit -m "fix: preserve score import semantics"
```

---

### Task 4: Update the web score query, adapter, and presentation

**Files:**
- Modify: `packages/dtx-web/src/lib/api/operations/score.graphql`
- Regenerate: `packages/dtx-web/src/lib/api/generated/graphql.ts`
- Modify: `packages/dtx-web/src/lib/api/score.ts`
- Test: `packages/dtx-web/src/lib/api/score.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ScoreCard.svelte`
- Test: `packages/dtx-web/src/lib/components/ScoreCard.test.ts`
- Test: `packages/dtx-web/src/routes/(app)/app/score/score-page.test.ts` only if its fixtures include the changed GraphQL shape.
- Test fixture: `packages/e2e-web/score.spec.ts` only if its mocked score contract includes removed score-level fields.

**Interfaces:**
- Consumes: Task 2 GraphQL schema.
- Produces: web view models and rendering with chart-level full-combo/max-combo and nullable recent clear state.

- [ ] **Step 1: Update the GraphQL operation before regenerating types**

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

Remove score-level `fullCombo` / `maxCombo` selections.

- [ ] **Step 2: Regenerate GraphQL client types**

Run:

```bash
bun run --filter=dtx-web codegen
```

Expected: `generated/graphql.ts` reflects `ChartScore.fullCombo/maxCombo` and nullable `Score.cleared`.

- [ ] **Step 3: Write/update adapter tests against the generated contract**

Update `score.test.ts` fixtures so:

```ts
myChartScore: {
	playCount: 7,
	clearCount: 4,
	fullCombo: true,
	maxCombo: 812,
	scores: [
		{
			isBest: true,
			score: 987654,
			cleared: null,
			performedAt: null,
			// judgment fields...
		},
		{
			isBest: false,
			cleared: null,
			performedAt: '2026-08-14T13:00:00Z',
			displayOrder: 1
		}
	]
}
```

Assert `ChartScoreView.fullCombo/maxCombo` are retained and score clear state stays `null`.

- [ ] **Step 4: Narrow `ScoreView` and extend `ChartScoreView`**

Change `score.ts` to:

```ts
export type ScoreView = {
	id: number;
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
};

export type ChartScoreView = {
	playCount: number;
	clearCount: number;
	fullCombo: boolean;
	maxCombo: number;
	best: ScoreView | null;
	recent: ScoreView[];
};
```

Remove the two aggregate assignments from `toScoreView`; add them to `toChartScoreView`:

```ts
fullCombo: cs.fullCombo,
maxCombo: cs.maxCombo,
```

- [ ] **Step 5: Move aggregate presentation out of the best row**

In `ScoreCard.svelte`, render `chart.chartScore.fullCombo` and `chart.chartScore.maxCombo` in the chart summary near play/clear counts.

Delete:

```svelte
{#if best.fullCombo} ... {/if}
{#if best.maxCombo != null} ... {/if}
```

from the best block. Keep score, achievement rate, rank, and judgment display unchanged.

For recent rows, replace the boolean truthiness branch with:

```svelte
{#if recent.cleared === true}
	<span class="text-green-300">{$_('score.cleared')}</span>
{:else if recent.cleared === false}
	<span class="text-red-300">{$_('score.failed')}</span>
{:else}
	<span class="text-slate-500">—</span>
{/if}
```

Do not invent a new “unknown result” translation unless product copy later requires one.

- [ ] **Step 6: Update `ScoreCard` tests**

Pin these behaviors:

1. full-combo and max-combo render when the **chart aggregate** says so;
2. the best score block still renders score/rank/rate/judgments;
3. a recent `cleared: null` row renders neither Cleared nor Failed;
4. existing true/false recent rows retain green/red result copy.

Update page/E2E fixtures only where TypeScript or fixture parsing requires the new shape; do not add a new navigation scenario.

- [ ] **Step 7: Run web tests, codegen drift check, and Svelte check**

Run:

```bash
bun run --filter=dtx-web test
bun run --filter=dtx-web lint:codegen
bun run --filter=dtx-web check
```

Expected: all web unit/component tests pass and generated GraphQL code has no drift.

- [ ] **Step 8: Commit Task 4**

```bash
git add packages/dtx-web/src/lib/api/operations/score.graphql \
  packages/dtx-web/src/lib/api/generated/graphql.ts \
  packages/dtx-web/src/lib/api/score.ts \
  packages/dtx-web/src/lib/api/score.test.ts \
  packages/dtx-web/src/lib/components/ScoreCard.svelte \
  packages/dtx-web/src/lib/components/ScoreCard.test.ts
git commit -m "fix: render chart score aggregates"
```

---

### Task 5: Run the cross-package regression gate

**Files:**
- Modify only files proven necessary by failures in the commands below; do not opportunistically refactor unrelated score code.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: one verified breaking score-contract change with no stale old-shape references.

- [ ] **Step 1: Search for stale score-level aggregate references**

Run:

```bash
rg "\.fullCombo|\.maxCombo|full_combo|max_combo" packages/common packages/dtx-api packages/dtx-desktop packages/dtx-web
```

Review every match. Valid matches after HPA-308 are chart-aggregate fields, DTXManiaCX source-row fields in Rust, migration backfill references to the old columns, and unrelated domains. There must be no `ScoreRow` / `ScorePayload` / `ScoreView` ownership of full-combo or max-combo.

Then search for clear-state coercion:

```bash
rg "cleared.*false|unwrap_or\(false\)" packages/dtx-desktop packages/dtx-api packages/dtx-web
```

Any score-history fallback from unknown to failure must be removed; unrelated boolean defaults may remain.

- [ ] **Step 2: Run all affected package tests**

Run:

```bash
bun run --filter=@dtx/common test
bun run --filter=dtx-api test
bun run --filter=dtx-desktop test
bun run --filter=dtx-web test
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
```

Expected: all affected suites pass.

- [ ] **Step 3: Run type/check/codegen gates**

Run:

```bash
bun run --filter=dtx-desktop check
bun run --filter=dtx-web check
bun run --filter=dtx-web lint:codegen
```

Expected: no stale generated types or Svelte/TypeScript contract errors.

- [ ] **Step 4: Run repository diff hygiene**

Run:

```bash
git diff --check main...HEAD
```

Expected: no whitespace errors.

- [ ] **Step 5: Commit only regression-driven fixture adjustments, if any**

If Step 2 or 3 required changes outside Tasks 1-4, commit only those proven fixes:

```bash
git add <only-files-changed-for-regression-fixes>
git commit -m "test: update score contract fixtures"
```

If no additional files changed, do not create an empty commit.

## Plan self-review

- **Spec coverage:** D1 migration/backfill, shared row/query types, GraphQL schema/input validation, desktop parser/upload/rendering, web query/adapter/rendering, and cross-package verification are all assigned to tasks.
- **Semantic coverage:** best score keeps only the stat block DTXManiaCX updates together; chart-level full-combo/max-combo are preserved; best timestamp/result are cleared; malformed recent result remains unknown.
- **Scope check:** no new table/domain abstraction, no new score-history feature, no compatibility path, and no unrelated upload/navigation changes.
- **Type consistency:** `ChartScore` owns `fullCombo: boolean` / `maxCombo: number`; `Score.cleared` is nullable end-to-end; score-level full-combo/max-combo are removed at every boundary.
- **Verification coverage:** each task has a focused red/green test cycle and the final task runs all affected package/native checks.