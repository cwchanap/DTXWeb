# Score Page — Phase 1 (Server / API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side score storage and GraphQL for the DTXMania score-import feature: a per-user `chart_scores` intermediate table + individual `scores` table, the query layer, and the `uploadScores` mutation / `myScoredSimfiles` query / `DtxFile.myChartScore` field.

**Architecture:** Scores live in Cloudflare D1. `dtx_files` stays a global chart definition; a new `chart_scores` row is per `(user, chart)` and holds aggregates (`play_count`, `clear_count`); individual `scores` (one `is_best` + up to 5 recent) hang off a `chart_scores` row. Reads use the existing Drizzle layer; the new write/read helpers use raw D1 `prepare`/`batch` (matching `createDtxFiles`/`deleteSimfile`). GraphQL is code-first Pothos.

**Tech Stack:** Bun 1.3.9, Vitest, Drizzle ORM (D1), Pothos + GraphQL Yoga, Cloudflare D1 (SQLite).

## Global Constraints

- Branch: `feat/score-page` (already created).
- Package commands: common tests `bun run --filter=@dtx/common test -- <file>`; API tests `bun run --filter=dtx-api test -- <file>`; API typecheck `bun run --filter=dtx-api check`.
- **Build order:** the API imports `@dtx/common/server` from `dist`. After changing `@dtx/common`, run `bun run --filter=@dtx/common build` before running API typecheck/tests.
- SQLite booleans are `INTEGER` 0/1; timestamps are `TEXT` ISO-8601. Row types mirror this (`0 | 1`, `string`).
- Prettier: tabs, single quotes, width 100.
- Exactly one `is_best` row per `chart_scores` (partial unique index). At most 5 recent rows (rows with non-null `display_order`).
- Migrations are manual (no CI/CD). This plan only _authors_ `0002_scores.sql`; applying it to D1 happens at deploy time.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- `packages/dtx-api/dist/schema.graphql` is git-tracked and must be regenerated + committed (Task 10).

## File Structure

**Create:**

- `packages/dtx-api/d1-migrations/0002_scores.sql` — the D1 migration (chart_scores + scores).
- `packages/dtx-api/src/schema/score.ts` — `Score`/`ChartScore` object types, upload input/result types, `uploadScores` mutation.

**Modify:**

- `packages/common/src/lib/server/db/schema.ts` — add `chartScores`, `scores` Drizzle tables.
- `packages/common/src/lib/types/d1.types.ts` — add row/insert types; widen `SimfileWithDtxFiles.dtx_files`.
- `packages/common/src/lib/server/db.ts` — add score query helpers; add `id` to dtx joins.
- `packages/common/src/lib/server.ts` — export new tables, types, and helpers.
- `packages/dtx-api/src/services/createSimfile.ts` — preserve chart `id` in the returned dtx list.
- `packages/dtx-api/src/schema/simfile.ts` — expose `DtxFile.id` + `DtxFile.myChartScore`; add `myScoredSimfiles` query.
- `packages/dtx-api/src/schema/index.ts` — register `./score`.

**Test (modify):**

- `packages/common/src/lib/server/db.test.ts` — schema + query-helper tests.
- `packages/dtx-api/src/schema/score.test.ts` — created in Task 7; grows through Tasks 8–9.

---

### Task 1: Migration, Drizzle schema, and row types

**Files:**

- Create: `packages/dtx-api/d1-migrations/0002_scores.sql`
- Modify: `packages/common/src/lib/server/db/schema.ts`
- Modify: `packages/common/src/lib/types/d1.types.ts`
- Modify: `packages/common/src/lib/server.ts`
- Test: `packages/common/src/lib/server/db.test.ts`

**Interfaces:**

- Produces (Drizzle): `chartScores`, `scores` sqliteTables.
- Produces (types): `ChartScoreRow`, `ChartScoreInsert`, `ScoreRow`, `ScoreInsert`.

- [ ] **Step 1: Write the migration file**

Create `packages/dtx-api/d1-migrations/0002_scores.sql`:

```sql
-- 0002_scores.sql
-- Per-user score import from DTXManiaCX.
-- dtx_files stays a global chart definition; chart_scores is the per-user
-- intermediate holding aggregates; scores holds individual plays.

CREATE TABLE IF NOT EXISTS chart_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0,
    clear_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_id) REFERENCES dtx_files(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_chart_scores_user_chart ON chart_scores(user_id, chart_id);
CREATE INDEX idx_chart_scores_chart ON chart_scores(chart_id);

CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_score_id INTEGER NOT NULL,
    is_best INTEGER NOT NULL DEFAULT 0,
    score INTEGER,
    achievement_rate REAL,
    rank_label TEXT,
    full_combo INTEGER NOT NULL DEFAULT 0,
    cleared INTEGER NOT NULL DEFAULT 0,
    max_combo INTEGER,
    perfect INTEGER, great INTEGER, good INTEGER, poor INTEGER, miss INTEGER,
    performed_at TEXT,
    display_order INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_score_id) REFERENCES chart_scores(id) ON DELETE CASCADE
);
CREATE INDEX idx_scores_chart_score ON scores(chart_score_id);
CREATE UNIQUE INDEX idx_scores_one_best ON scores(chart_score_id) WHERE is_best = 1;
```

- [ ] **Step 2: Write the failing schema test**

Append to `packages/common/src/lib/server/db.test.ts`. First add the imports at the top (extend the existing `./db/schema` import):

```ts
import { simfiles, dtxFiles, userProfiles, chartScores, scores } from './db/schema';
```

Then append this block after the existing `describe('db schema', ...)`:

```ts
describe('score schema', () => {
	it('exports the chart_scores and scores tables', () => {
		expect(chartScores).toBeDefined();
		expect(scores).toBeDefined();
	});

	it('defines the unique (user, chart) index on chart_scores', () => {
		const config = getTableConfig(chartScores);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('idx_chart_scores_user_chart');
		expect(indexNames).toContain('idx_chart_scores_chart');
	});

	it('defines the chart_score index on scores', () => {
		const config = getTableConfig(scores);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('idx_scores_chart_score');
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: FAIL — `chartScores`/`scores` are `undefined` (not exported from schema).

- [ ] **Step 4: Add the Drizzle tables**

In `packages/common/src/lib/server/db/schema.ts`, after the `dtxFiles` table, add:

```ts
export const chartScores = sqliteTable(
	'chart_scores',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		chartId: integer('chart_id')
			.notNull()
			.references(() => dtxFiles.id, { onDelete: 'cascade' }),
		userId: text('user_id').notNull(),
		playCount: integer('play_count').notNull().default(0),
		clearCount: integer('clear_count').notNull().default(0),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`)
	},
	(table) => ({
		userChartUniqueIdx: uniqueIndex('idx_chart_scores_user_chart').on(
			table.userId,
			table.chartId
		),
		chartIdx: index('idx_chart_scores_chart').on(table.chartId)
	})
);

export const scores = sqliteTable(
	'scores',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		chartScoreId: integer('chart_score_id')
			.notNull()
			.references(() => chartScores.id, { onDelete: 'cascade' }),
		isBest: integer('is_best').$type<0 | 1>().notNull().default(0),
		score: integer('score'),
		achievementRate: real('achievement_rate'),
		rankLabel: text('rank_label'),
		fullCombo: integer('full_combo').$type<0 | 1>().notNull().default(0),
		cleared: integer('cleared').$type<0 | 1>().notNull().default(0),
		maxCombo: integer('max_combo'),
		perfect: integer('perfect'),
		great: integer('great'),
		good: integer('good'),
		poor: integer('poor'),
		miss: integer('miss'),
		performedAt: text('performed_at'),
		displayOrder: integer('display_order'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`)
	},
	(table) => ({
		chartScoreIdx: index('idx_scores_chart_score').on(table.chartScoreId)
	})
);
```

> Note: the partial unique index `idx_scores_one_best` (`WHERE is_best = 1`) is not expressible via Drizzle's `uniqueIndex` here; it lives only in the migration SQL (Step 1). The Drizzle tables are used for query building/tests, not for producing the migration.

- [ ] **Step 5: Add the row/insert types**

In `packages/common/src/lib/types/d1.types.ts`, after `DtxFileInsert`, add:

```ts
export interface ChartScoreRow {
	id: number;
	chart_id: number;
	user_id: string;
	play_count: number;
	clear_count: number;
	created_at: string;
	updated_at: string;
}

export interface ChartScoreInsert {
	chart_id: number;
	user_id: string;
	play_count?: number;
	clear_count?: number;
}

export interface ScoreRow {
	id: number;
	chart_score_id: number;
	is_best: 0 | 1;
	score: number | null;
	achievement_rate: number | null;
	rank_label: string | null;
	full_combo: 0 | 1;
	cleared: 0 | 1;
	max_combo: number | null;
	perfect: number | null;
	great: number | null;
	good: number | null;
	poor: number | null;
	miss: number | null;
	performed_at: string | null;
	display_order: number | null;
	created_at: string;
}

export interface ScoreInsert {
	is_best?: boolean;
	score?: number | null;
	achievement_rate?: number | null;
	rank_label?: string | null;
	full_combo?: boolean;
	cleared?: boolean;
	max_combo?: number | null;
	perfect?: number | null;
	great?: number | null;
	good?: number | null;
	poor?: number | null;
	miss?: number | null;
	performed_at?: string | null;
	display_order?: number | null;
}
```

- [ ] **Step 6: Export the new tables and types**

In `packages/common/src/lib/server.ts`:

Add to the Drizzle-schema export line:

```ts
export { simfiles, dtxFiles, userProfiles, chartScores, scores } from './server/db/schema';
```

Add to the `export type { ... } from './types/d1.types'` block these members: `ChartScoreRow`, `ChartScoreInsert`, `ScoreRow`, `ScoreInsert`.

- [ ] **Step 7: Run test to verify it passes**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: PASS (all `score schema` tests green).

- [ ] **Step 8: Commit**

```bash
git add packages/dtx-api/d1-migrations/0002_scores.sql \
  packages/common/src/lib/server/db/schema.ts \
  packages/common/src/lib/types/d1.types.ts \
  packages/common/src/lib/server.ts \
  packages/common/src/lib/server/db.test.ts
git commit -m "feat(common): add chart_scores + scores schema and D1 migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Expose chart `id` through the dtx join

**Files:**

- Modify: `packages/common/src/lib/types/d1.types.ts`
- Modify: `packages/common/src/lib/server/db.ts:100-110` (getSimfile dtx select) and the `listSimfiles` dtx select
- Modify: `packages/dtx-api/src/services/createSimfile.ts:20,51`
- Test: `packages/common/src/lib/server/db.test.ts`

**Interfaces:**

- Produces: `SimfileWithDtxFiles.dtx_files` now `{ id?: number; level: number; label: string }[]`; `getSimfile`/`listSimfiles`/create path carry chart `id`.

- [ ] **Step 1: Write the failing test**

Append to `packages/common/src/lib/server/db.test.ts` inside the existing `describe('getSimfile', ...)` (or add a new `describe`):

```ts
describe('getSimfile chart id', () => {
	it('includes the dtx_files id in the joined result', async () => {
		drizzleSelectResults.push([baseSimfileRow]); // simfile select
		drizzleSelectResults.push([{ id: 77, level: 5, label: 'BASIC' }]); // dtx select
		const result = await getSimfile({} as unknown as D1Database, 1);
		expect(result?.dtx_files).toEqual([{ id: 77, level: 5, label: 'BASIC' }]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: FAIL — result `dtx_files` is `[{ level: 5, label: 'BASIC' }]` (no `id`), because the select omits it.

- [ ] **Step 3: Widen the type**

In `packages/common/src/lib/types/d1.types.ts`, change the `SimfileWithDtxFiles` interface's `dtx_files` field and the `toSimfileWithDtx` signature:

```ts
export interface SimfileWithDtxFiles extends Omit<SimfileRow, 'is_published' | 'user_id'> {
	is_published: boolean;
	user_id?: string;
	dtx_files: { id?: number; level: number; label: string }[];
}
```

```ts
export const toSimfileWithDtx = (
	row: Omit<SimfileRow, 'user_id'> & { user_id?: string },
	dtxFiles: { id?: number; level: number; label: string }[]
): SimfileWithDtxFiles => ({
	...row,
	is_published: row.is_published === 1,
	dtx_files: dtxFiles
});
```

- [ ] **Step 4: Add `id` to both dtx selects**

In `packages/common/src/lib/server/db.ts`, the `getSimfile` dtx select (currently `{ level: dtxFiles.level, label: dtxFiles.label }`) becomes:

```ts
const dtx = await orm
	.select({
		id: dtxFiles.id,
		level: dtxFiles.level,
		label: dtxFiles.label
	})
	.from(dtxFiles)
	.where(eq(dtxFiles.simfileId, id));
```

Find the equivalent dtx select inside `listSimfiles` (same `{ level, label }` shape) and add `id: dtxFiles.id` the same way.

- [ ] **Step 5: Preserve `id` in the create path**

In `packages/dtx-api/src/services/createSimfile.ts`:

Change the `CreateSimfileResult` type (line ~20):

```ts
export type CreateSimfileResult = {
	simfile: SimfileRow;
	dtxFiles: { id?: number; label: string; level: number }[];
};
```

Change the mapping (line ~51):

```ts
return {
	simfile,
	dtxFiles: created.map((d) => ({ id: d.id, label: d.label, level: d.level }))
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: PASS (new test green; existing dtx tests still pass — `id` is optional so rows without it are unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/common/src/lib/types/d1.types.ts \
  packages/common/src/lib/server/db.ts \
  packages/common/src/lib/server/db.test.ts \
  packages/dtx-api/src/services/createSimfile.ts
git commit -m "feat(common): carry dtx_files id through simfile joins

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `getChartVisibility` helper

**Files:**

- Modify: `packages/common/src/lib/server/db.ts`
- Modify: `packages/common/src/lib/server.ts`
- Test: `packages/common/src/lib/server/db.test.ts`

**Interfaces:**

- Produces: `getChartVisibility(db, chartId): Promise<{ user_id: string; is_published: 0 | 1 } | null>`.

- [ ] **Step 1: Write the failing test**

Append to `db.test.ts`. Add `getChartVisibility` to the `from './db'` import list, then:

```ts
describe('getChartVisibility', () => {
	it("returns the owning simfile's visibility for a chart", async () => {
		const db = createMockDb(() => createMockStmt({ user_id: 'user-9', is_published: 1 }));
		const result = await getChartVisibility(db as unknown as D1Database, 55);
		expect(result).toEqual({ user_id: 'user-9', is_published: 1 });
	});

	it('returns null when the chart does not exist', async () => {
		const db = createMockDb(() => createMockStmt(null));
		const result = await getChartVisibility(db as unknown as D1Database, 999);
		expect(result).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: FAIL — `getChartVisibility is not a function`.

- [ ] **Step 3: Implement**

In `packages/common/src/lib/server/db.ts`, after `getSimfileOwner`, add:

```ts
export const getChartVisibility = async (
	db: D1Database,
	chartId: number
): Promise<{ user_id: string; is_published: 0 | 1 } | null> => {
	const row = await db
		.prepare(
			`SELECT s.user_id AS user_id, s.is_published AS is_published
			 FROM dtx_files d JOIN simfiles s ON s.id = d.simfile_id
			 WHERE d.id = ? LIMIT 1`
		)
		.bind(chartId)
		.first<{ user_id: string; is_published: 0 | 1 }>();
	return row ?? null;
};
```

Export it from `packages/common/src/lib/server.ts` (add `getChartVisibility` to the `./server/db` export block).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/common/src/lib/server/db.ts packages/common/src/lib/server.ts packages/common/src/lib/server/db.test.ts
git commit -m "feat(common): add getChartVisibility query helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `upsertChartScore` + `replaceScores` helpers

**Files:**

- Modify: `packages/common/src/lib/server/db.ts`
- Modify: `packages/common/src/lib/server.ts`
- Test: `packages/common/src/lib/server/db.test.ts`

**Interfaces:**

- Consumes: `ChartScoreRow`, `ScoreInsert` (Task 1).
- Produces:
    - `upsertChartScore(db, { chartId, userId, playCount, clearCount }): Promise<ChartScoreRow>`
    - `replaceScores(db, chartScoreId, scores: ScoreInsert[]): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `db.test.ts`. Add `upsertChartScore, replaceScores` to the `from './db'` import; ensure `ScoreInsert` type is available via `import type { ScoreInsert } from '../types/d1.types';` at the top if you reference it.

```ts
describe('upsertChartScore', () => {
	it('returns the upserted chart_scores row', async () => {
		const row = {
			id: 3,
			chart_id: 55,
			user_id: 'u1',
			play_count: 10,
			clear_count: 4,
			created_at: 't',
			updated_at: 't'
		};
		const db = createMockDb(() => createMockStmt(row));
		const result = await upsertChartScore(db as unknown as D1Database, {
			chartId: 55,
			userId: 'u1',
			playCount: 10,
			clearCount: 4
		});
		expect(result).toEqual(row);
	});

	it('throws when RETURNING yields no row', async () => {
		const db = createMockDb(() => createMockStmt(null));
		await expect(
			upsertChartScore(db as unknown as D1Database, {
				chartId: 1,
				userId: 'u1',
				playCount: 0,
				clearCount: 0
			})
		).rejects.toThrow();
	});
});

describe('replaceScores', () => {
	it('batches a delete followed by one insert per score', async () => {
		const db = createMockDb();
		db.batch = vi.fn().mockResolvedValue([]);
		await replaceScores(db as unknown as D1Database, 3, [
			{ is_best: true, score: 900000, achievement_rate: 91.3 },
			{ is_best: false, achievement_rate: 82.4, display_order: 1 }
		]);
		expect(db.prepare).toHaveBeenCalledTimes(3); // 1 delete + 2 inserts
		expect(db.batch).toHaveBeenCalledTimes(1);
		expect(db.batch.mock.calls[0][0]).toHaveLength(3);
	});

	it('batches only the delete when there are no scores', async () => {
		const db = createMockDb();
		db.batch = vi.fn().mockResolvedValue([]);
		await replaceScores(db as unknown as D1Database, 3, []);
		expect(db.prepare).toHaveBeenCalledTimes(1);
		expect(db.batch.mock.calls[0][0]).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement**

In `packages/common/src/lib/server/db.ts` add (types `ChartScoreRow`, `ScoreInsert` are already imported from `../types/d1.types` — extend that import):

```ts
export const upsertChartScore = async (
	db: D1Database,
	params: { chartId: number; userId: string; playCount: number; clearCount: number }
): Promise<ChartScoreRow> => {
	const now = new Date().toISOString();
	const row = await db
		.prepare(
			`INSERT INTO chart_scores
				(chart_id, user_id, play_count, clear_count, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(user_id, chart_id) DO UPDATE SET
				play_count = excluded.play_count,
				clear_count = excluded.clear_count,
				updated_at = excluded.updated_at
			 RETURNING *`
		)
		.bind(params.chartId, params.userId, params.playCount, params.clearCount, now, now)
		.first<ChartScoreRow>();
	if (!row) throw new Error('Failed to upsert chart_score');
	return row;
};

export const replaceScores = async (
	db: D1Database,
	chartScoreId: number,
	scores: ScoreInsert[]
): Promise<void> => {
	const statements = [
		db.prepare('DELETE FROM scores WHERE chart_score_id = ?').bind(chartScoreId),
		...scores.map((s) =>
			db
				.prepare(
					`INSERT INTO scores
						(chart_score_id, is_best, score, achievement_rate, rank_label,
						 full_combo, cleared, max_combo, perfect, great, good, poor, miss,
						 performed_at, display_order)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					chartScoreId,
					s.is_best ? 1 : 0,
					s.score ?? null,
					s.achievement_rate ?? null,
					s.rank_label ?? null,
					s.full_combo ? 1 : 0,
					s.cleared ? 1 : 0,
					s.max_combo ?? null,
					s.perfect ?? null,
					s.great ?? null,
					s.good ?? null,
					s.poor ?? null,
					s.miss ?? null,
					s.performed_at ?? null,
					s.display_order ?? null
				)
		)
	];
	await db.batch(statements);
};
```

Export both from `packages/common/src/lib/server.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/common/src/lib/server/db.ts packages/common/src/lib/server.ts packages/common/src/lib/server/db.test.ts
git commit -m "feat(common): add upsertChartScore + replaceScores helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `getUserChartScore` helper

**Files:**

- Modify: `packages/common/src/lib/server/db.ts`
- Modify: `packages/common/src/lib/server.ts`
- Test: `packages/common/src/lib/server/db.test.ts`

**Interfaces:**

- Consumes: `ChartScoreRow`, `ScoreRow`.
- Produces: `getUserChartScore(db, userId, chartId): Promise<{ chartScore: ChartScoreRow; scores: ScoreRow[] } | null>`.

- [ ] **Step 1: Write the failing tests**

Append to `db.test.ts` (add `getUserChartScore` to the `./db` import):

```ts
describe('getUserChartScore', () => {
	it('returns null when there is no chart_scores row', async () => {
		const db = createMockDb(() => createMockStmt(null));
		const result = await getUserChartScore(db as unknown as D1Database, 'u1', 55);
		expect(result).toBeNull();
	});

	it('returns the chart_scores row with its ordered scores', async () => {
		const chartScore = {
			id: 3,
			chart_id: 55,
			user_id: 'u1',
			play_count: 10,
			clear_count: 4,
			created_at: 't',
			updated_at: 't'
		};
		const scoreRows = [
			{ id: 1, chart_score_id: 3, is_best: 1 },
			{ id: 2, chart_score_id: 3, is_best: 0, display_order: 1 }
		];
		const db = createMockDb((sql: string) =>
			sql.includes('FROM chart_scores')
				? createMockStmt(chartScore)
				: createMockStmt(null, scoreRows)
		);
		const result = await getUserChartScore(db as unknown as D1Database, 'u1', 55);
		expect(result?.chartScore).toEqual(chartScore);
		expect(result?.scores).toEqual(scoreRows);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: FAIL — `getUserChartScore is not a function`.

- [ ] **Step 3: Implement**

In `packages/common/src/lib/server/db.ts`:

```ts
export const getUserChartScore = async (
	db: D1Database,
	userId: string,
	chartId: number
): Promise<{ chartScore: ChartScoreRow; scores: ScoreRow[] } | null> => {
	const chartScore = await db
		.prepare('SELECT * FROM chart_scores WHERE user_id = ? AND chart_id = ? LIMIT 1')
		.bind(userId, chartId)
		.first<ChartScoreRow>();
	if (!chartScore) return null;
	const { results } = await db
		.prepare(
			`SELECT * FROM scores WHERE chart_score_id = ?
			 ORDER BY is_best DESC, display_order ASC`
		)
		.bind(chartScore.id)
		.all<ScoreRow>();
	return { chartScore, scores: results ?? [] };
};
```

Add `ScoreRow` to the `../types/d1.types` import, and export `getUserChartScore` from `server.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/common/src/lib/server/db.ts packages/common/src/lib/server.ts packages/common/src/lib/server/db.test.ts
git commit -m "feat(common): add getUserChartScore query helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `listUserScoredSimfiles` helper

**Files:**

- Modify: `packages/common/src/lib/server/db.ts`
- Modify: `packages/common/src/lib/server.ts`
- Test: `packages/common/src/lib/server/db.test.ts`

**Interfaces:**

- Consumes: `toSimfileWithDtx`, `SimfileRow`, `DtxFileRow`.
- Produces: `listUserScoredSimfiles(db, { userId, page?, pageSize? }): Promise<{ data: SimfileWithDtxFiles[]; count: number }>`.

- [ ] **Step 1: Write the failing tests**

Append to `db.test.ts` (add `listUserScoredSimfiles` to the `./db` import). `toSimfileWithDtx` is already mocked at the top of the file to spread its args, so assertions see plain objects.

```ts
describe('listUserScoredSimfiles', () => {
	it('returns empty when the user has no scores', async () => {
		const db = createMockDb(() => createMockStmt(null, []));
		const result = await listUserScoredSimfiles(db as unknown as D1Database, { userId: 'u1' });
		expect(result).toEqual({ data: [], count: 0 });
	});

	it('lists scored simfiles with their dtx_files', async () => {
		const scoredSimfileRow = { ...baseSimfileRow, id: 42 };
		const db = createMockDb((sql: string) => {
			if (sql.includes('DISTINCT')) return createMockStmt(null, [{ simfile_id: 42 }]);
			if (sql.includes('FROM simfiles')) return createMockStmt(null, [scoredSimfileRow]);
			return createMockStmt(null, [{ id: 10, label: 'BASIC', level: 5, simfile_id: 42 }]);
		});
		const result = await listUserScoredSimfiles(db as unknown as D1Database, {
			userId: 'user-1'
		});
		expect(result.count).toBe(1);
		expect(result.data[0].id).toBe(42);
		expect(result.data[0].dtx_files).toEqual([{ id: 10, level: 5, label: 'BASIC' }]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: FAIL — `listUserScoredSimfiles is not a function`.

- [ ] **Step 3: Implement**

In `packages/common/src/lib/server/db.ts` (add `SimfileRow`, `DtxFileRow` to the `../types/d1.types` import if not already present; `toSimfileWithDtx` is already imported):

```ts
export const listUserScoredSimfiles = async (
	db: D1Database,
	options: { userId: string; page?: number; pageSize?: number }
): Promise<{ data: SimfileWithDtxFiles[]; count: number }> => {
	const page = options.page ?? 1;
	const pageSize = options.pageSize ?? 20;

	const { results: idRows } = await db
		.prepare(
			`SELECT DISTINCT d.simfile_id AS simfile_id
			 FROM chart_scores cs JOIN dtx_files d ON d.id = cs.chart_id
			 WHERE cs.user_id = ?
			 ORDER BY d.simfile_id DESC`
		)
		.bind(options.userId)
		.all<{ simfile_id: number }>();

	const simfileIds = (idRows ?? []).map((r) => r.simfile_id);
	const count = simfileIds.length;
	if (count === 0) return { data: [], count: 0 };

	const pageIds = simfileIds.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
	const placeholders = pageIds.map(() => '?').join(',');

	const { results: simfileRows } = await db
		.prepare(`SELECT * FROM simfiles WHERE id IN (${placeholders}) ORDER BY id DESC`)
		.bind(...pageIds)
		.all<SimfileRow>();

	const { results: dtxRows } = await db
		.prepare(
			`SELECT id, label, level, simfile_id FROM dtx_files WHERE simfile_id IN (${placeholders})`
		)
		.bind(...pageIds)
		.all<DtxFileRow>();

	const data = (simfileRows ?? []).map((row) =>
		toSimfileWithDtx(
			row,
			(dtxRows ?? [])
				.filter((d) => d.simfile_id === row.id)
				.map((d) => ({ id: d.id, level: d.level, label: d.label }))
		)
	);

	return { data, count };
};
```

Export `listUserScoredSimfiles` from `server.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=@dtx/common test -- db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/common/src/lib/server/db.ts packages/common/src/lib/server.ts packages/common/src/lib/server/db.test.ts
git commit -m "feat(common): add listUserScoredSimfiles query helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: GraphQL `Score`/`ChartScore` types + `DtxFile.id`/`myChartScore`

**Files:**

- Create: `packages/dtx-api/src/schema/score.ts`
- Modify: `packages/dtx-api/src/schema/simfile.ts` (`DtxFileParent`, `DtxFile` fields)
- Modify: `packages/dtx-api/src/schema/index.ts`
- Test: `packages/dtx-api/src/schema/score.test.ts` (create)

**Interfaces:**

- Consumes: `ScoreRow`, `ChartScoreRow` types; `getUserChartScore` (Tasks 1, 5).
- Produces: `ScoreRef`, `ChartScoreRef` object refs; `DtxFile.id: ID!`, `DtxFile.myChartScore: ChartScore`.

- [ ] **Step 1: Rebuild @dtx/common so the API sees the new exports**

Run: `bun run --filter=@dtx/common build`
Expected: build succeeds; `dist/server.js`/`dist/server.d.ts` now export the new helpers/types.

- [ ] **Step 2: Write the failing test**

Create `packages/dtx-api/src/schema/score.test.ts`. This mirrors `simfile.test.ts`'s harness:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfile: vi.fn(),
		getSimfileOwner: vi.fn(),
		getChartVisibility: vi.fn(),
		getUserChartScore: vi.fn(),
		upsertChartScore: vi.fn(),
		replaceScores: vi.fn(),
		listUserScoredSimfiles: vi.fn()
	};
});

const { schema } = await import('./index');
const { getSimfile, getSimfileOwner, getUserChartScore } = await import('@dtx/common/server');
const mockedGetSimfile = vi.mocked(getSimfile);
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedGetUserChartScore = vi.mocked(getUserChartScore);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: ''
});

const makeCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
	user: null,
	session: null,
	env: makeEnv(),
	db: {} as Ctx['db'],
	r2: {} as Ctx['r2'],
	kv: {} as Ctx['kv'],
	request: new Request('http://test'),
	logger: workerLogger,
	ownerByIdCache: new Map(),
	hasUploadedFilesCache: new Map(),
	filesCache: new Map(),
	catalogFilesCache: new Map(),
	...overrides
});

const runQuery = async (ctx: Ctx, body: Record<string, unknown>) => {
	const yoga = createYoga<{ ctx: Ctx }>({
		schema,
		context: (req) => req.ctx,
		maskedErrors: false,
		cors: false,
		landingPage: false
	});
	const response = await yoga.fetch(
		'http://test/graphql',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		},
		{ ctx }
	);
	return response.json() as Promise<{
		data?: Record<string, unknown>;
		errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
	}>;
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('DtxFile.myChartScore', () => {
	it("resolves the signed-in user's chart score for a chart", async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'owner-1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({
			id: 42,
			title: 'Song',
			artist: 'Artist',
			bpm: 150,
			is_published: true,
			user_id: 'owner-1',
			display_id: null,
			download_url: null,
			preview_url: null,
			video_preview_url: null,
			publish_date: 't',
			created_at: 't',
			updated_at: 't',
			dtx_files: [{ id: 10, level: 5, label: 'BASIC' }]
		} as never);
		mockedGetUserChartScore.mockResolvedValue({
			chartScore: {
				id: 3,
				chart_id: 10,
				user_id: 'user-1',
				play_count: 10,
				clear_count: 4,
				created_at: 't',
				updated_at: 't'
			},
			scores: [
				{
					id: 1,
					chart_score_id: 3,
					is_best: 1,
					score: 912380,
					achievement_rate: 91.3,
					rank_label: 'S',
					full_combo: 0,
					cleared: 1,
					max_combo: 903,
					perfect: 1300,
					great: 120,
					good: 20,
					poor: 5,
					miss: 5,
					performed_at: 't',
					display_order: null,
					created_at: 't'
				}
			]
		});

		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: `query {
				simfile(id: "42") {
					dtxFiles { id myChartScore { playCount clearCount scores { isBest score achievementRate rankLabel } } }
				}
			}`
		});

		const dtx = (result.data?.simfile as { dtxFiles: unknown[] }).dtxFiles[0] as {
			id: string;
			myChartScore: { playCount: number; clearCount: number; scores: unknown[] };
		};
		expect(dtx.id).toBe('10');
		expect(dtx.myChartScore.playCount).toBe(10);
		expect(dtx.myChartScore.scores[0]).toMatchObject({
			isBest: true,
			score: 912380,
			achievementRate: 91.3,
			rankLabel: 'S'
		});
	});

	it('resolves null when unauthenticated', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'owner-1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({
			id: 42,
			title: 'Song',
			artist: 'Artist',
			bpm: 150,
			is_published: true,
			user_id: 'owner-1',
			display_id: null,
			download_url: null,
			preview_url: null,
			video_preview_url: null,
			publish_date: 't',
			created_at: 't',
			updated_at: 't',
			dtx_files: [{ id: 10, level: 5, label: 'BASIC' }]
		} as never);

		const result = await runQuery(makeCtx(), {
			query: `query { simfile(id: "42") { dtxFiles { myChartScore { playCount } } } }`
		});
		const dtx = (result.data?.simfile as { dtxFiles: unknown[] }).dtxFiles[0] as {
			myChartScore: unknown;
		};
		expect(dtx.myChartScore).toBeNull();
		expect(mockedGetUserChartScore).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run --filter=dtx-api test -- score.test.ts`
Expected: FAIL — `Cannot query field "id" / "myChartScore" on type "DtxFile"`.

- [ ] **Step 4: Create `score.ts` object types**

Create `packages/dtx-api/src/schema/score.ts`:

```ts
import type { ScoreRow, ChartScoreRow } from '@dtx/common/server';
import { builder } from './builder';

export const ScoreRef = builder.objectRef<ScoreRow>('Score').implement({
	fields: (t) => ({
		id: t.id({ resolve: (s) => String(s.id) }),
		isBest: t.boolean({ resolve: (s) => s.is_best === 1 }),
		score: t.int({ nullable: true, resolve: (s) => s.score }),
		achievementRate: t.float({ nullable: true, resolve: (s) => s.achievement_rate }),
		rankLabel: t.string({ nullable: true, resolve: (s) => s.rank_label }),
		fullCombo: t.boolean({ resolve: (s) => s.full_combo === 1 }),
		cleared: t.boolean({ resolve: (s) => s.cleared === 1 }),
		maxCombo: t.int({ nullable: true, resolve: (s) => s.max_combo }),
		perfect: t.int({ nullable: true, resolve: (s) => s.perfect }),
		great: t.int({ nullable: true, resolve: (s) => s.great }),
		good: t.int({ nullable: true, resolve: (s) => s.good }),
		poor: t.int({ nullable: true, resolve: (s) => s.poor }),
		miss: t.int({ nullable: true, resolve: (s) => s.miss }),
		performedAt: t.string({ nullable: true, resolve: (s) => s.performed_at }),
		displayOrder: t.int({ nullable: true, resolve: (s) => s.display_order })
	})
});

export type ChartScoreParent = { chartScore: ChartScoreRow; scores: ScoreRow[] };

export const ChartScoreRef = builder.objectRef<ChartScoreParent>('ChartScore').implement({
	fields: (t) => ({
		id: t.id({ resolve: (c) => String(c.chartScore.id) }),
		playCount: t.int({ resolve: (c) => c.chartScore.play_count }),
		clearCount: t.int({ resolve: (c) => c.chartScore.clear_count }),
		scores: t.field({ type: [ScoreRef], resolve: (c) => c.scores })
	})
});
```

- [ ] **Step 5: Extend `DtxFile` in `simfile.ts`**

Add the import near the top of `packages/dtx-api/src/schema/simfile.ts`:

```ts
import { ChartScoreRef } from './score';
import { getUserChartScore } from '@dtx/common/server';
```

Change the `DtxFileParent` type to carry the chart id:

```ts
type DtxFileParent = {
	id?: number;
	level: number;
	label: string;
	index: number;
	simfile: SimfileWithDtxFiles;
};
```

In the `DtxFile` objectRef `fields`, add `id` and `myChartScore` (alongside the existing `level`/`label`/`fileUrl`/…):

```ts
		id: t.id({ resolve: (file) => String(file.id) }),
		myChartScore: t.field({
			type: ChartScoreRef,
			nullable: true,
			resolve: async (file, _args, ctx) => {
				if (!ctx.user || file.id == null) return null;
				return getUserChartScore(ctx.db, ctx.user.id, file.id);
			}
		}),
```

The `SimfileRef.dtxFiles` resolver already spreads each dtx row: `s.dtx_files.map((file, index) => ({ ...file, index, simfile: s }))`. Since `dtx_files` rows now include `id` (Task 2), `file.id` flows into `DtxFileParent`. No change needed there.

- [ ] **Step 6: Register `score.ts`**

In `packages/dtx-api/src/schema/index.ts`, add after `import './simfile';`:

```ts
import './score';
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun run --filter=dtx-api test -- score.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

Run: `bun run --filter=dtx-api check`
Expected: no errors.

```bash
git add packages/dtx-api/src/schema/score.ts \
  packages/dtx-api/src/schema/simfile.ts \
  packages/dtx-api/src/schema/index.ts \
  packages/dtx-api/src/schema/score.test.ts
git commit -m "feat(api): add Score/ChartScore types and DtxFile.myChartScore

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `uploadScores` mutation

**Files:**

- Modify: `packages/dtx-api/src/schema/score.ts`
- Test: `packages/dtx-api/src/schema/score.test.ts`

**Interfaces:**

- Consumes: `getChartVisibility`, `upsertChartScore`, `replaceScores`; `ScoreInsert`.
- Produces: `Mutation.uploadScores(input: UploadScoresInput!): UploadScoresResult!`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/dtx-api/src/schema/score.test.ts`. Extend the destructured mocks:

```ts
const { getChartVisibility, upsertChartScore, replaceScores } = await import('@dtx/common/server');
const mockedVisibility = vi.mocked(getChartVisibility);
const mockedUpsert = vi.mocked(upsertChartScore);
const mockedReplace = vi.mocked(replaceScores);

const uploadMutation = `
	mutation ($input: UploadScoresInput!) {
		uploadScores(input: $input) {
			updatedCharts
			insertedScores
			skipped { chartId reason }
		}
	}`;

const chartScoreRow = {
	id: 3,
	chart_id: 10,
	user_id: 'user-1',
	play_count: 10,
	clear_count: 4,
	created_at: 't',
	updated_at: 't'
};

describe('uploadScores', () => {
	it('rejects unauthenticated callers', async () => {
		const result = await runQuery(makeCtx(), {
			query: uploadMutation,
			variables: { input: { charts: [] } }
		});
		expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
	});

	it('upserts a visible chart and replaces its scores', async () => {
		mockedVisibility.mockResolvedValue({ user_id: 'owner-1', is_published: 1 });
		mockedUpsert.mockResolvedValue(chartScoreRow);
		mockedReplace.mockResolvedValue(undefined);

		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 10,
							clearCount: 4,
							scores: [
								{
									isBest: true,
									score: 912380,
									achievementRate: 91.3,
									rankLabel: 'S',
									fullCombo: false,
									cleared: true,
									maxCombo: 903,
									perfect: 1300,
									great: 120,
									good: 20,
									poor: 5,
									miss: 5,
									performedAt: 't'
								},
								{
									isBest: false,
									achievementRate: 82.4,
									rankLabel: 'A',
									fullCombo: false,
									cleared: true,
									displayOrder: 1,
									performedAt: 't'
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			insertedScores: number;
			skipped: unknown[];
		};
		expect(payload.updatedCharts).toBe(1);
		expect(payload.insertedScores).toBe(2);
		expect(payload.skipped).toEqual([]);
		expect(mockedUpsert).toHaveBeenCalledWith({}, expect.anything()); // db is {} in ctx
		expect(mockedReplace).toHaveBeenCalledTimes(1);
	});

	it('skips a chart that is not visible to the caller', async () => {
		mockedVisibility.mockResolvedValue(null);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: { charts: [{ chartId: '999', playCount: 0, clearCount: 0, scores: [] }] }
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(0);
		expect(payload.skipped[0].chartId).toBe('999');
		expect(mockedUpsert).not.toHaveBeenCalled();
	});

	it('skips a chart with more than 5 recent scores', async () => {
		mockedVisibility.mockResolvedValue({ user_id: 'owner-1', is_published: 1 });
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const recent = Array.from({ length: 6 }, (_v, i) => ({
			isBest: false,
			achievementRate: 50,
			rankLabel: 'E',
			fullCombo: false,
			cleared: false,
			displayOrder: i + 1
		}));
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: { charts: [{ chartId: '10', playCount: 6, clearCount: 0, scores: recent }] }
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].chartId).toBe('10');
		expect(mockedUpsert).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter=dtx-api test -- score.test.ts`
Expected: FAIL — `Unknown type "UploadScoresInput"` / `uploadScores` not defined.

- [ ] **Step 3: Implement input types, result types, and the mutation**

Append to `packages/dtx-api/src/schema/score.ts` (extend the `@dtx/common/server` import with `getChartVisibility, upsertChartScore, replaceScores` and `type ScoreInsert`):

```ts
import { GraphQLError } from 'graphql';

const ScoreInput = builder.inputType('ScoreInput', {
	fields: (t) => ({
		isBest: t.boolean({ required: true }),
		score: t.int({ required: false }),
		achievementRate: t.float({ required: false }),
		rankLabel: t.string({ required: false }),
		fullCombo: t.boolean({ required: true }),
		cleared: t.boolean({ required: true }),
		maxCombo: t.int({ required: false }),
		perfect: t.int({ required: false }),
		great: t.int({ required: false }),
		good: t.int({ required: false }),
		poor: t.int({ required: false }),
		miss: t.int({ required: false }),
		performedAt: t.string({ required: false }),
		displayOrder: t.int({ required: false })
	})
});

const ChartScoresInput = builder.inputType('ChartScoresInput', {
	fields: (t) => ({
		chartId: t.id({ required: true }),
		playCount: t.int({ required: true }),
		clearCount: t.int({ required: true }),
		scores: t.field({ type: [ScoreInput], required: true })
	})
});

const UploadScoresInput = builder.inputType('UploadScoresInput', {
	fields: (t) => ({
		charts: t.field({ type: [ChartScoresInput], required: true })
	})
});

const SkippedChartRef = builder
	.objectRef<{ chartId: string; reason: string }>('SkippedChart')
	.implement({
		fields: (t) => ({
			chartId: t.exposeID('chartId'),
			reason: t.exposeString('reason')
		})
	});

const UploadScoresResultRef = builder
	.objectRef<{
		updatedCharts: number;
		insertedScores: number;
		skipped: { chartId: string; reason: string }[];
	}>('UploadScoresResult')
	.implement({
		fields: (t) => ({
			updatedCharts: t.exposeInt('updatedCharts'),
			insertedScores: t.exposeInt('insertedScores'),
			skipped: t.field({ type: [SkippedChartRef], resolve: (r) => r.skipped })
		})
	});

// Validates a single chart payload. Returns a skip reason string, or null when valid.
const validateChartScores = (
	scores: {
		isBest: boolean;
		achievementRate?: number | null;
		score?: number | null;
		displayOrder?: number | null;
	}[]
): string | null => {
	const bestCount = scores.filter((s) => s.isBest).length;
	if (bestCount > 1) return 'more than one best score';
	const recentCount = scores.filter((s) => s.displayOrder != null).length;
	if (recentCount > 5) return 'more than 5 recent scores';
	for (const s of scores) {
		if (s.score != null && !Number.isFinite(s.score)) return 'non-finite score';
		if (s.achievementRate != null && (s.achievementRate < 0 || s.achievementRate > 100)) {
			return 'achievementRate out of range';
		}
	}
	return null;
};

builder.mutationField('uploadScores', (t) =>
	t.field({
		type: UploadScoresResultRef,
		args: { input: t.arg({ type: UploadScoresInput, required: true }) },
		authScopes: { user: true },
		resolve: async (_root, { input }, ctx) => {
			const skipped: { chartId: string; reason: string }[] = [];
			let updatedCharts = 0;
			let insertedScores = 0;

			for (const chart of input.charts) {
				const numericId = Number(chart.chartId);
				if (!Number.isSafeInteger(numericId) || numericId <= 0) {
					skipped.push({ chartId: String(chart.chartId), reason: 'invalid chart id' });
					continue;
				}

				const invalid = validateChartScores(
					chart.scores.map((s) => ({
						isBest: s.isBest,
						achievementRate: s.achievementRate,
						score: s.score,
						displayOrder: s.displayOrder
					}))
				);
				if (invalid) {
					skipped.push({ chartId: String(chart.chartId), reason: invalid });
					continue;
				}

				const visibility = await getChartVisibility(ctx.db, numericId);
				const visible =
					visibility != null &&
					(visibility.is_published === 1 || visibility.user_id === ctx.user!.id);
				if (!visible) {
					skipped.push({ chartId: String(chart.chartId), reason: 'chart not found' });
					continue;
				}

				const chartScore = await upsertChartScore(ctx.db, {
					chartId: numericId,
					userId: ctx.user!.id,
					playCount: chart.playCount,
					clearCount: chart.clearCount
				});

				const inserts: ScoreInsert[] = chart.scores.map((s) => ({
					is_best: s.isBest,
					score: s.score ?? null,
					achievement_rate: s.achievementRate ?? null,
					rank_label: s.rankLabel ?? null,
					full_combo: s.fullCombo,
					cleared: s.cleared,
					max_combo: s.maxCombo ?? null,
					perfect: s.perfect ?? null,
					great: s.great ?? null,
					good: s.good ?? null,
					poor: s.poor ?? null,
					miss: s.miss ?? null,
					performed_at: s.performedAt ?? null,
					display_order: s.displayOrder ?? null
				}));
				await replaceScores(ctx.db, chartScore.id, inserts);
				updatedCharts += 1;
				insertedScores += inserts.length;
			}

			return { updatedCharts, insertedScores, skipped };
		}
	})
);
```

> `GraphQLError` is imported for parity with other schema modules even though skips avoid throwing; if your linter flags it as unused, drop that import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter=dtx-api test -- score.test.ts`
Expected: PASS (all `uploadScores` tests green).

- [ ] **Step 5: Typecheck and commit**

Run: `bun run --filter=dtx-api check`
Expected: no errors.

```bash
git add packages/dtx-api/src/schema/score.ts packages/dtx-api/src/schema/score.test.ts
git commit -m "feat(api): add uploadScores mutation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `myScoredSimfiles` query

**Files:**

- Modify: `packages/dtx-api/src/schema/simfile.ts`
- Test: `packages/dtx-api/src/schema/score.test.ts`

**Interfaces:**

- Consumes: `listUserScoredSimfiles`; existing `SimfileConnectionRef`.
- Produces: `Query.myScoredSimfiles(page: Int = 1, pageSize: Int = 20): SimfileConnection!`.

- [ ] **Step 1: Write the failing test**

Append to `packages/dtx-api/src/schema/score.test.ts` (extend the mocks import with `listUserScoredSimfiles`):

```ts
const { listUserScoredSimfiles } = await import('@dtx/common/server');
const mockedListScored = vi.mocked(listUserScoredSimfiles);

describe('myScoredSimfiles', () => {
	it('rejects unauthenticated callers', async () => {
		const result = await runQuery(makeCtx(), {
			query: `query { myScoredSimfiles { count data { id } } }`
		});
		expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
	});

	it("returns the caller's scored simfiles", async () => {
		mockedListScored.mockResolvedValue({
			count: 1,
			data: [
				{
					id: 42,
					title: 'Song',
					artist: 'Artist',
					bpm: 150,
					is_published: true,
					user_id: 'user-1',
					display_id: null,
					download_url: null,
					preview_url: null,
					video_preview_url: null,
					publish_date: 't',
					created_at: 't',
					updated_at: 't',
					dtx_files: [{ id: 10, level: 5, label: 'BASIC' }]
				}
			]
		} as never);

		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: `query { myScoredSimfiles { count data { id title dtxFiles { id level } } } }`
		});
		const conn = result.data?.myScoredSimfiles as {
			count: number;
			data: { id: string; title: string; dtxFiles: { id: string; level: number }[] }[];
		};
		expect(conn.count).toBe(1);
		expect(conn.data[0].id).toBe('42');
		expect(conn.data[0].dtxFiles[0].id).toBe('10');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-api test -- score.test.ts`
Expected: FAIL — `Cannot query field "myScoredSimfiles" on type "Query"`.

- [ ] **Step 3: Implement the query**

In `packages/dtx-api/src/schema/simfile.ts`, add `listUserScoredSimfiles` to the `@dtx/common/server` import, then add after the existing `simfiles` query field:

```ts
builder.queryField('myScoredSimfiles', (t) =>
	t.field({
		type: SimfileConnectionRef,
		args: {
			page: t.arg.int({ required: false, defaultValue: 1 }),
			pageSize: t.arg.int({ required: false, defaultValue: 20 })
		},
		authScopes: { user: true },
		resolve: async (_root, args, ctx) =>
			listUserScoredSimfiles(ctx.db, {
				userId: ctx.user!.id,
				page: args.page ?? 1,
				pageSize: args.pageSize ?? 20
			})
	})
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-api test -- score.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `bun run --filter=dtx-api check`
Expected: no errors.

```bash
git add packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/score.test.ts
git commit -m "feat(api): add myScoredSimfiles query

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Regenerate the GraphQL schema artifact

**Files:**

- Modify: `packages/dtx-api/dist/schema.graphql` (generated)

**Interfaces:**

- Produces: an up-to-date `dist/schema.graphql` including `Score`, `ChartScore`, `UploadScoresInput`, `uploadScores`, `myScoredSimfiles`, and `DtxFile.id`/`myChartScore` — consumed by the web `codegen` in Phase 2.

- [ ] **Step 1: Regenerate the schema**

Run: `bun run --filter=dtx-api gen-schema`
Expected: `Wrote .../packages/dtx-api/dist/schema.graphql`.

- [ ] **Step 2: Verify the new SDL is present**

Run: `grep -nE "type Score|type ChartScore|uploadScores|myScoredSimfiles|myChartScore" packages/dtx-api/dist/schema.graphql`
Expected: matches for each (types, mutation, query, and the `DtxFile.myChartScore` field).

- [ ] **Step 3: Run the full API + common test suites once**

Run: `bun run --filter=@dtx/common test` then `bun run --filter=dtx-api test`
Expected: both suites PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-api/dist/schema.graphql
git commit -m "chore(api): regenerate GraphQL schema for scores

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 1 Self-Review

- **Spec coverage:** `chart_scores`/`scores` tables + migration (Task 1); `dtx_files.id` exposure (Tasks 2, 7); `getChartVisibility`/`upsertChartScore`/`replaceScores`/`getUserChartScore`/`listUserScoredSimfiles` query layer (Tasks 3–6); `Score`/`ChartScore` GraphQL + `DtxFile.myChartScore` (Task 7); `uploadScores` with user-scope + visibility skip + validation (Task 8); `myScoredSimfiles` (Task 9); schema regen (Task 10). Replace-per-chart transaction is realized by `upsertChartScore` + `replaceScores` (`db.batch`). The partial unique index (one best) is in the migration SQL.
- **Deferred to later phases (by design):** the web dashboard/UI (Phase 2) and the desktop rusqlite parser + `Scores.svelte` + `upload_scores` command (Phase 3). Applying `0002_scores.sql` to real D1 happens at API deploy time (manual, per project convention).
- **Type consistency:** `ScoreRow`/`ChartScoreRow`/`ScoreInsert` names and snake_case fields are consistent across common + API; `getUserChartScore` returns `{ chartScore, scores }`, matched by `ChartScoreParent` and the `ChartScore` resolver; `uploadScores` input field names (`chartId`, `playCount`, `clearCount`, `scores`, `displayOrder`, …) match the mutation resolver's usage.
