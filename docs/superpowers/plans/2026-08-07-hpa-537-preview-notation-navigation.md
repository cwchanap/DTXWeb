# HPA-537 Preview Notation and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove doubled measure boundaries, render effective BPM changes in the public notation preview, and route public blog users to Preview while owner chart-management users remain editor-first.

**Architecture:** Normalize DTX tempo changes once in `@dtx/common`, expose the sequence as `ChartTiming.tempoEvents`, and expose an equivalent sequence on `NotationChart` for VexFlow rendering. Keep VexFlow's existing end bars and suppress only redundant begin bars between adjacent measures. Keep navigation UI contextual, but centralize the small route predicate in existing `ChartList.helpers.ts` so card/table behavior cannot drift.

**Tech Stack:** TypeScript 5.x, Svelte 5 / SvelteKit 2.x, VexFlow 4.2.5, Vitest, Testing Library, Playwright, Bun workspaces.

## Global Constraints

- No database, GraphQL, API, auth, or codegen changes.
- No desktop/Tauri or Phaser gameplay-preview changes.
- No generic notation-event framework; add only `NotationTempoEvent`.
- `ChartTiming.tempoEvents` is the single normalized effective tempo sequence used by forward/inverse timing.
- `NotationChart.tempoEvents` must equal the timing sequence by value; reference identity is not a contract.
- The first normalized tempo event is the timing engine's initial BPM; do not separately initialize timing from raw `input.bpm`.
- Support base BPM, channel `08` (`#BPMxx`) changes, and legacy channel `03` direct-hex changes.
- Exact-position ties preserve input order; `buildNotationChart()` supplies channel `08` before converted channel `03`, so channel `03` wins an exact tie.
- Invalid, non-finite, non-positive, or unresolved BPM changes are ignored and retain the prior effective tempo.
- Consecutive effective events with the same BPM are collapsed.
- VexFlow already renders begin/end single bars; only suppress the begin bar for non-first staves in a row.
- All BPM markings use VexFlow `StaveTempo`; they must not participate in the rhythmic `Voice`, alter note spacing, or affect cursor geometry.
- Public blog navigation targets `/preview/[id]`; owner chart-list navigation targets `/editor/[id]`.
- A blog item that is not previewable stays non-clickable; it must never fall back to Editor.
- Do not add Editor actions to the public preview or Preview actions to the editor shell.
- Do not create a shared `ChartActions` UI component; only reuse pure route predicates.
- Every task must finish with the relevant package `check` command passing before commit.

---

## File Structure

### Shared notation/timing

- `packages/common/src/lib/notation/model.ts`
  - Task 1 adds `NotationTempoEvent`; Task 2 extends `NotationChart` only when all chart producers/fixtures are updated in the same commit.
- `packages/common/src/lib/notation/timing.ts`
  - Owns `normalizeTempoEvents()` and uses it for forward/inverse timing.
- `packages/common/src/lib/notation/timing.test.ts`
  - Owns normalization and timing invariants independent of DTX parsing.
- `packages/common/src/lib/notation/quantize.ts`
  - Keeps existing channel `03` synthetic-key conversion, calls `buildChartTiming()`, and exposes equivalent tempo events on `NotationChart`.
- `packages/common/src/lib/notation/quantize.test.ts`
  - Owns DTX integration coverage for channels `08` / `03`, exact-tie ordering, and value equivalence.

### Web preview rendering

- `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
  - Suppresses redundant begin bars and draws VexFlow tempo annotations.
- `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
  - Happy-path renderer orchestration with VexFlow mocked.
- `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`
  - Error-path VexFlow mock and non-fatal tempo annotation coverage.
- `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`
  - Updates existing chart/timing fixtures when `NotationChart.tempoEvents` becomes required; no trivial page-level BPM test.

### Navigation

- `packages/dtx-web/src/lib/components/ChartList.helpers.ts`
  - Existing helper module; add only `isPreviewable()` and `chartTitleHref()` pure navigation helpers.
- `packages/dtx-web/src/lib/components/ChartList.test.ts`
  - Test the navigation matrix at the pure-helper seam and keep one table-title integration check per context.
- `packages/dtx-web/src/lib/components/ChartListItem.svelte`
  - Uses helpers for card title destination and Preview visibility.
- `packages/dtx-web/src/lib/components/ChartListItem.test.ts`
  - Verifies card wiring and explicit Preview/Edit-details actions.
- `packages/dtx-web/src/lib/components/ChartList.svelte`
  - Uses `chartTitleHref()` for table-row title destination.
- `packages/dtx-web/src/lib/components/ChartListTableItem.svelte`
  - Uses `isPreviewable()` for compact table actions and a distinct Preview icon.
- `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`
  - Existing test file; extend current navigation/download/delete coverage and update the existing `Edit` assertion.

### Browser coverage

- `packages/e2e-web/fixtures/preview-tempo.dtx`
  - New preview-only fixture containing real playable `#NNNCC:` note lines plus a channel `08` tempo change.
- `packages/e2e-web/preview.spec.ts`
  - Uses only the preview-specific fixture and verifies real VexFlow tempo text.
- `packages/e2e-web/blog.spec.ts`
  - Verifies the seeded published chart navigates from Blog to `/preview/[id]`.
- `packages/e2e-web/fixtures/test-sample.dtx`
  - Unchanged; remains shared by converter/upload specs and `setup/prepare-stack.ts`.

---

## Implementation Risks

- **Intermediate type safety:** `NotationChart.tempoEvents` must not become required before `quantize.ts`, `NotationView` fixtures, and preview-page fixtures are updated. Task boundaries below are chosen so every commit type-checks.
- **VexFlow barline defaults:** VexFlow 4.2.5 already creates `SINGLE` begin/end bars. The user-visible change is only `setBegBarType(BarlineType.NONE)` for non-first staves in a row; do not add a redundant `setEndBarType(SINGLE)` call/test.
- **Geometry shift:** removing the begin bar can change `stave.getNoteStartX()`. Geometry is rebuilt in the same render pass, but cursor/seek behavior remains in the regression blast radius and must be covered by existing web/E2E tests.
- **VexFlow enum values:** `BarlineType.SINGLE === 1`, `BarlineType.NONE === 7`; mocks must use the real values and production code must use enum members.
- **StaveTempo context:** construct/draw tempo marks only after the stave has a context and the rhythmic notation has rendered; catch each annotation independently.
- **StaveTempo offset:** VexFlow adds an internal `+10px` `shift_x`, so browser tests must not assert exact pixel positions.
- **Tempo-label collision:** multiple tempo events in the same measure share a baseline and can overlap. Defer vertical staggering/collision avoidance unless real-chart evidence justifies a follow-up.
- **SVG text selector:** if Playwright `getByText` is brittle for VexFlow SVG output, inspect only the notation container's `svg text` nodes; do not snapshot SVG.
- **Existing navigation tests:** `ChartListTableItem.test.ts` already asserts `Edit`; update that assertion in the same task as the copy rename.
- **Popover test stub:** `PopoverStub.svelte` always renders the content snippet, so action-menu tests must not click the trigger before asserting menu items.
- **Fixture validity:** DTX playable/object lines must start with `#NNNCC:`. Bare `001:` lines are ignored by `DTXFile.parseNotes()` and must not be used in `preview-tempo.dtx`.
- **Fixture isolation:** do not add tempo directives to shared `test-sample.dtx`.

---

### Task 1: Normalize effective tempo once in `ChartTiming`

**Files:**
- Modify: `packages/common/src/lib/notation/model.ts`
- Modify: `packages/common/src/lib/notation/timing.ts`
- Test: `packages/common/src/lib/notation/timing.test.ts`

**Interfaces:**
- Consumes: existing `TimingInput { bpm, bpmValueMap, bpmChanges, measureLengths, measureCount }`.
- Produces: `NotationTempoEvent`, `normalizeTempoEvents(input): NotationTempoEvent[]`, and `ChartTiming.tempoEvents: NotationTempoEvent[]`.
- Does **not** change `NotationChart` yet; Task 1 must compile independently.

- [ ] **Step 1: Add failing normalization/timing tests**

Update the import:

```ts
import { buildChartTiming, normalizeTempoEvents } from './timing';
```

Add:

```ts
it('normalizes the base bpm into an initial tempo event', () => {
	const events = normalizeTempoEvents({
		bpm: 120,
		bpmValueMap: {},
		bpmChanges: [],
		measureLengths: [1],
		measureCount: 1
	});

	expect(events).toEqual([{ measure: 0, fraction: 0, bpm: 120 }]);
});

it('falls back an invalid base bpm to 120 for both events and timing', () => {
	const timing = buildChartTiming({
		bpm: Number.NaN,
		bpmValueMap: {},
		bpmChanges: [],
		measureLengths: [1],
		measureCount: 1
	});

	expect(timing.tempoEvents).toEqual([{ measure: 0, fraction: 0, bpm: 120 }]);
	expect(timing.totalDuration).toBe(2);
});

it('normalizes mid-measure changes and collapses duplicate effective bpm values', () => {
	const bpmChanges = [
		new LaneMeasureNote(0, '08', [
			{ noteID: 'AA', position: 0.5 },
			{ noteID: 'BB', position: 0.75 }
		]),
		new LaneMeasureNote(1, '08', [{ noteID: 'CC', position: 0 }])
	];

	const events = normalizeTempoEvents({
		bpm: 120,
		bpmValueMap: { AA: 180, BB: 180, CC: 240 },
		bpmChanges,
		measureLengths: [1, 1],
		measureCount: 2
	});

	expect(events).toEqual([
		{ measure: 0, fraction: 0, bpm: 120 },
		{ measure: 0, fraction: 0.5, bpm: 180 },
		{ measure: 1, fraction: 0, bpm: 240 }
	]);
});

it('keeps only the final valid change at an exact musical position', () => {
	const bpmChanges = [
		new LaneMeasureNote(0, '08', [{ noteID: 'AA', position: 0 }]),
		new LaneMeasureNote(0, '08', [{ noteID: 'BB', position: 0 }])
	];

	expect(
		normalizeTempoEvents({
			bpm: 120,
			bpmValueMap: { AA: 180, BB: 240 },
			bpmChanges,
			measureLengths: [1],
			measureCount: 1
		})
	).toEqual([{ measure: 0, fraction: 0, bpm: 240 }]);
});

it('ignores unresolved and non-positive bpm changes for events and duration', () => {
	const bpmChanges = [
		new LaneMeasureNote(0, '08', [
			{ noteID: 'MISSING', position: 0.25 },
			{ noteID: 'ZERO', position: 0.5 },
			{ noteID: 'NEG', position: 0.75 }
		])
	];

	const timing = buildChartTiming({
		bpm: 120,
		bpmValueMap: { ZERO: 0, NEG: -10 },
		bpmChanges,
		measureLengths: [1],
		measureCount: 1
	});

	expect(timing.tempoEvents).toEqual([{ measure: 0, fraction: 0, bpm: 120 }]);
	expect(timing.totalDuration).toBe(2);
});
```

Extend the existing mid-measure round-trip test:

```ts
expect(timing.tempoEvents).toEqual([
	{ measure: 0, fraction: 0, bpm: 120 },
	{ measure: 0, fraction: 0.5, bpm: 240 }
]);
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts
```

Expected: FAIL because the new helper/property does not exist.

- [ ] **Step 3: Add only `NotationTempoEvent` to the notation model**

In `model.ts`, add:

```ts
export interface NotationTempoEvent {
	measure: number;
	fraction: number;
	bpm: number;
}
```

Do **not** modify `NotationChart` in Task 1.

- [ ] **Step 4: Implement `normalizeTempoEvents()`**

In `timing.ts`:

```ts
import type { NotationTempoEvent } from './model';

interface OrderedTempoChange extends NotationTempoEvent {
	order: number;
}

export const normalizeTempoEvents = (input: TimingInput): NotationTempoEvent[] => {
	const initialBpm = Number.isFinite(input.bpm) && input.bpm > 0 ? input.bpm : 120;
	const changes: OrderedTempoChange[] = [];
	let order = 0;

	for (const laneMeasure of input.bpmChanges) {
		for (const note of laneMeasure.notes) {
			if (note.noteID === '00') continue;
			const bpm = input.bpmValueMap[note.noteID];
			if (!Number.isFinite(bpm) || bpm <= 0) continue;
			if (laneMeasure.measure < 0 || laneMeasure.measure >= input.measureCount) continue;
			if (note.position < 0 || note.position > 1) continue;

			changes.push({
				measure: laneMeasure.measure,
				fraction: note.position,
				bpm,
				order: order++
			});
		}
	}

	changes.sort(
		(a, b) => a.measure - b.measure || a.fraction - b.fraction || a.order - b.order
	);

	const events: NotationTempoEvent[] = [{ measure: 0, fraction: 0, bpm: initialBpm }];
	for (const change of changes) {
		const previous = events[events.length - 1];
		const samePosition =
			previous.measure === change.measure && previous.fraction === change.fraction;

		if (samePosition) {
			previous.bpm = change.bpm;
			continue;
		}
		if (previous.bpm === change.bpm) continue;
		events.push({ measure: change.measure, fraction: change.fraction, bpm: change.bpm });
	}

	return events.filter((event, index) => index === 0 || event.bpm !== events[index - 1].bpm);
};
```

- [ ] **Step 5: Refactor forward/inverse timing to consume normalized events**

Update `ChartTiming`:

```ts
export interface ChartTiming {
	tempoEvents: NotationTempoEvent[];
	measureStartSeconds: number[];
	totalDuration: number;
	positionToTime(measure: number, fraction: number): number;
	timeToPosition(t: number): { measure: number; fraction: number };
}
```

Refactor `secondsIntoMeasure()` to accept the current measure length, starting BPM, and normalized events:

```ts
const secondsIntoMeasure = (
	measure: number,
	fraction: number,
	measureLength: number,
	startBpm: number,
	tempoEvents: NotationTempoEvent[]
): { seconds: number; endBpm: number } => {
	const perFraction = (bpm: number, frac: number) =>
		(60 / bpm) * BEATS_PER_WHOLE * frac * measureLength;
	const changes = tempoEvents.filter(
		(event) => event.measure === measure && event.fraction <= fraction
	);

	let seconds = 0;
	let bpm = startBpm;
	let last = 0;
	for (const change of changes) {
		seconds += perFraction(bpm, change.fraction - last);
		bpm = change.bpm;
		last = change.fraction;
	}
	seconds += perFraction(bpm, fraction - last);
	return { seconds, endBpm: bpm };
};
```

Build `fractionAtSeconds()` from the same per-measure event list rather than raw `bpmChanges`:

```ts
const bounds = tempoEvents.filter(
	(event) => event.measure === measure && event.fraction >= 0 && event.fraction < 1
);
```

Initialize `buildChartTiming()` from normalization:

```ts
const tempoEvents = normalizeTempoEvents(input);
const initialBpm = tempoEvents[0]?.bpm ?? 120;
const measureStartSeconds: number[] = [];
const measureBpmAtStart: number[] = [];
let elapsed = 0;
let bpm = initialBpm;
```

Use `initialBpm` for conversion-function fallback, pass `tempoEvents` into both helpers, and return it:

```ts
return {
	tempoEvents,
	measureStartSeconds,
	totalDuration,
	positionToTime,
	timeToPosition
};
```

- [ ] **Step 6: Verify Task 1 completely**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts
bun run --filter=@dtx/common check
```

Expected: PASS. `NotationChart` is unchanged, so no downstream chart literal is broken by this commit.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/common/src/lib/notation/model.ts \
  packages/common/src/lib/notation/timing.ts \
  packages/common/src/lib/notation/timing.test.ts
git commit -m "feat(common): normalize preview tempo events"
```

---

### Task 2: Expose normalized tempo events through `NotationChart`

**Files:**
- Modify: `packages/common/src/lib/notation/model.ts`
- Modify: `packages/common/src/lib/notation/quantize.ts`
- Test: `packages/common/src/lib/notation/quantize.test.ts`
- Test fixture update: `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`
- Test fixture update: `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
- Test fixture update: `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`

**Interfaces:**
- Consumes: `ChartTiming.tempoEvents` from Task 1.
- Produces: required `NotationChart.tempoEvents` with values equal to `timing.tempoEvents`.
- Preserves existing channel `03` conversion to synthetic `03:${noteID}` keys.

- [ ] **Step 1: Add failing DTX integration tests**

Add to `quantize.test.ts`:

```ts
it('exposes channel 08 bpm changes on the notation chart', () => {
	const dtx = makeDtx(['#BPMAA: 180', '#00108: AA'], 120);
	const { chart, timing } = buildNotationChart(dtx);

	expect(chart.tempoEvents).toEqual([
		{ measure: 0, fraction: 0, bpm: 120 },
		{ measure: 1, fraction: 0, bpm: 180 }
	]);
	expect(chart.tempoEvents).toEqual(timing.tempoEvents);
});

it('lets converted channel 03 win an exact same-position tie after channel 08', () => {
	const dtx = makeDtx(['#BPMAA: 180', '#00108: AA', '#00103: F0'], 120);
	const { chart, timing } = buildNotationChart(dtx);

	expect(chart.tempoEvents).toEqual([
		{ measure: 0, fraction: 0, bpm: 120 },
		{ measure: 1, fraction: 0, bpm: 240 }
	]);
	expect(chart.tempoEvents).toEqual(timing.tempoEvents);
});

it('preserves the exact fraction of a mid-measure bpm change', () => {
	const dtx = makeDtx(['#BPMAA: 180', '#00008: 00AA'], 120);
	const { chart } = buildNotationChart(dtx);

	expect(chart.tempoEvents).toEqual([
		{ measure: 0, fraction: 0, bpm: 120 },
		{ measure: 0, fraction: 0.5, bpm: 180 }
	]);
});
```

- [ ] **Step 2: Run the integration test and verify failure**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/quantize.test.ts
```

Expected: FAIL because `NotationChart` has no `tempoEvents` yet.

- [ ] **Step 3: Make `NotationChart.tempoEvents` required and update the producer in the same task**

In `model.ts`:

```ts
export interface NotationChart {
	measures: NotationMeasure[];
	tempoEvents: NotationTempoEvent[];
}
```

Keep the current legacy-channel conversion block in `quantize.ts`, then return:

```ts
const timing = buildChartTiming({
	bpm: dtx.bpm || 120,
	bpmValueMap,
	bpmChanges: [...(notesByLane[BPM_CHANNEL] ?? []), ...legacyBpmChanges],
	measureLengths,
	measureCount
});

return {
	chart: { measures, tempoEvents: [...timing.tempoEvents] },
	timing,
	notesByLane,
	measureCount
};
```

The copy is optional in production, but the tests intentionally assert value equality rather than alias identity.

- [ ] **Step 4: Update all typed chart fixtures in the same task**

In `preview-page.test.ts`, update `readyChart()`:

```ts
const readyChart = () => {
	const tempoEvents = [{ measure: 0, fraction: 0, bpm: 120 }];
	return {
		chart: {
			measures: [
				{ index: 0, measureTicks: 192, beatsPerMeasure: 4, entries: [], tuplets: [] }
			],
			tempoEvents: [...tempoEvents]
		},
		timing: {
			tempoEvents,
			totalDuration: 2,
			measureStartSeconds: [0],
			positionToTime: () => 0,
			timeToPosition: () => ({ measure: 0, fraction: 0 })
		},
		notesByLane: {},
		measureCount: 1
	};
};
```

In both `NotationView.test.ts` and `NotationView.errors.test.ts`, add `tempoEvents: []` to every base `NotationChart` literal that does not test tempo marks. Adjust other typed chart literals in those files the same way.

Do not add a page test that merely proves `chart = built.chart`.

- [ ] **Step 5: Verify Task 2 completely**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts src/lib/notation/quantize.test.ts
bun run --filter=dtx-web test -- \
  src/routes/preview/[id]/preview-page.test.ts \
  src/lib/components/preview/NotationView.test.ts \
  src/lib/components/preview/NotationView.errors.test.ts
bun run --filter=@dtx/common check
bun run --filter=dtx-web check
```

Expected: PASS. The required `NotationChart` field and every known typed test fixture land together.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/common/src/lib/notation/model.ts \
  packages/common/src/lib/notation/quantize.ts \
  packages/common/src/lib/notation/quantize.test.ts \
  packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts \
  packages/dtx-web/src/lib/components/preview/NotationView.test.ts \
  packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts
git commit -m "feat(common): expose notation tempo events"
```

---

### Task 3: Remove doubled measure boundaries and render BPM markings

**Files:**
- Modify: `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
- Test: `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
- Test: `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`

**Interfaces:**
- Consumes: `chart.tempoEvents` from Task 2.
- Produces: single visible boundary between adjacent measure staves plus isolated VexFlow `StaveTempo` annotations.
- Uses VexFlow 4.2.5 `BarlineType` and `StaveTempo`.

- [ ] **Step 1: Extend the happy-path VexFlow mock and add failing tests**

In `NotationView.test.ts` add captures:

```ts
const begBarTypes = vi.hoisted(() => [] as number[]);
const tempoCalls = vi.hoisted(
	() => [] as Array<{ x: number; bpm?: number; duration?: string }>
);
```

Extend mocked `Stave` only with the method production will actually call:

```ts
setBegBarType(type: number) {
	begBarTypes.push(type);
	return this;
}
```

Add VexFlow 4.2.5 enum values and tempo mock:

```ts
BarlineType: { SINGLE: 1, NONE: 7 },
StaveTempo: class {
	constructor(tempo: { bpm?: number; duration?: string }, x: number) {
		tempoCalls.push({ x, ...tempo });
	}
	draw() {
		return this;
	}
}
```

Import the mocked enum for assertions:

```ts
import { BarlineType } from 'vexflow';
```

Add:

```ts
it('suppresses the redundant begin bar on the second adjacent measure', async () => {
	const twoMeasureChart: NotationChart = {
		measures: [chart.measures[0], { ...chart.measures[0], index: 1 }],
		tempoEvents: []
	};

	render(NotationView, { props: { chart: twoMeasureChart } });
	await tick();

	expect(begBarTypes).toEqual([BarlineType.NONE]);
});

it('renders the starting tempo with VexFlow StaveTempo', async () => {
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0, bpm: 120 }]
	};

	render(NotationView, { props: { chart: tempoChart } });
	await tick();

	expect(tempoCalls).toContainEqual({ x: 30, bpm: 120, duration: 'q' });
});

it('renders a mid-measure tempo at the nominal proportional x without adding voice notes', async () => {
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0.5, bpm: 180 }]
	};

	render(NotationView, { props: { chart: tempoChart } });
	await tick();

	// Mocked note range is 30..200, so the constructor receives 115.
	// Real StaveTempo later applies its own internal +10px shift; browser tests do not assert pixels.
	expect(tempoCalls).toContainEqual({ x: 115, bpm: 180, duration: 'q' });
	expect(staveNoteArgs).toHaveLength(chart.measures[0].entries.length);
});
```

Clear new capture arrays in `beforeEach()`.

- [ ] **Step 2: Update the error-path VexFlow mock**

In `NotationView.errors.test.ts` add:

```ts
let throwTempoDraw = false;
```

Extend mocked `Stave`:

```ts
setBegBarType() {
	return this;
}
```

Add:

```ts
BarlineType: { SINGLE: 1, NONE: 7 },
StaveTempo: class {
	constructor(_tempo: unknown, _x: number) {}
	draw() {
		if (throwTempoDraw) throw new Error('tempo draw failed');
		return this;
	}
}
```

Reset `throwTempoDraw = false` in `beforeEach()`.

- [ ] **Step 3: Run renderer tests and verify failures**

```bash
bun run --filter=dtx-web test -- \
  src/lib/components/preview/NotationView.test.ts \
  src/lib/components/preview/NotationView.errors.test.ts
```

Expected: new begin-bar/tempo assertions FAIL because the component does not call these APIs yet.

- [ ] **Step 4: Suppress only redundant begin bars**

Import:

```ts
import {
	Renderer,
	Stave,
	StaveNote,
	Voice,
	Formatter,
	Beam,
	Tuplet,
	BarlineType,
	StaveTempo
} from 'vexflow';
```

After constructing each stave:

```ts
const firstInRow = x === LEFT;
const stave = new Stave(x, y, width);
if (!firstInRow) stave.setBegBarType(BarlineType.NONE);
```

Do not call `setEndBarType()`: VexFlow already creates the correct single end bar.

Keep existing clef/time-signature behavior unchanged.

- [ ] **Step 5: Build a per-measure tempo lookup once per render**

Before `layout.forEach(...)`:

```ts
const tempoEventsByMeasure = new Map<number, typeof chart.tempoEvents>();
for (const event of chart.tempoEvents) {
	const events = tempoEventsByMeasure.get(event.measure);
	if (events) events.push(event);
	else tempoEventsByMeasure.set(event.measure, [event]);
}
```

- [ ] **Step 6: Draw every BPM marking through isolated `StaveTempo`**

After the voice, beams, and tuplets are drawn:

```ts
const tempoEvents = tempoEventsByMeasure.get(measure.index) ?? [];
for (const event of tempoEvents) {
	try {
		const startX = stave.getNoteStartX();
		const endX = stave.getNoteEndX();
		const xPos = startX + event.fraction * (endX - startX);
		new StaveTempo({ bpm: event.bpm, duration: 'q' }, xPos, 0).draw(stave, 0);
	} catch (error) {
		console.warn(`Failed to render tempo in measure ${measure.index}`, error);
	}
}
```

Keep one path for measure-start and mid-measure marks. Do not put `StaveTempo` into the rhythmic `Voice`.

Increase only fixed headroom if required:

```ts
const SYSTEM_HEIGHT = 160;
const TOP = 30;
```

Do not add collision/stagger logic in this task.

- [ ] **Step 7: Add a non-fatal tempo-draw error test**

```ts
it('skips a failing tempo annotation without dropping the measure', async () => {
	const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	throwTempoDraw = true;
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0, bpm: 120 }]
	};

	const { container } = render(NotationView, { props: { chart: tempoChart } });
	await tick();

	expect(container.querySelector('[data-testid="notation-container"]')).toBeTruthy();
	expect(draw).toHaveBeenCalled();
	expect(warnSpy).toHaveBeenCalledWith(
		'Failed to render tempo in measure 0',
		expect.any(Error)
	);
	warnSpy.mockRestore();
});
```

- [ ] **Step 8: Verify Task 3 completely**

```bash
bun run --filter=dtx-web test -- \
  src/lib/components/preview/NotationView.test.ts \
  src/lib/components/preview/NotationView.errors.test.ts \
  src/routes/preview/[id]/preview-page.test.ts
bun run --filter=dtx-web check
```

Expected: PASS, including existing cursor/seek-oriented component/page coverage.

- [ ] **Step 9: Commit Task 3**

```bash
git add packages/dtx-web/src/lib/components/preview/NotationView.svelte \
  packages/dtx-web/src/lib/components/preview/NotationView.test.ts \
  packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts
git commit -m "feat(web): render preview tempo without doubled bars"
```

---

### Task 4: Centralize chart destination rules and apply them to card view

**Files:**
- Modify: `packages/dtx-web/src/lib/components/ChartList.helpers.ts`
- Test: `packages/dtx-web/src/lib/components/ChartList.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ChartListItem.svelte`
- Test: `packages/dtx-web/src/lib/components/ChartListItem.test.ts`

**Interfaces:**
- Produces: `isPreviewable(item): boolean` and `chartTitleHref(item, isBlog): string | null`.
- Card, table title, and table actions consume the same policy.
- No shared UI/action component.

- [ ] **Step 1: Add the pure navigation matrix to existing helper tests**

In `ChartList.test.ts`:

```ts
it('derives chart title destinations from public-vs-owner context', () => {
	const previewable = { id: 1, is_published: true, has_uploaded_files: true };
	const unpublished = { ...previewable, is_published: false };
	const withoutUpload = { ...previewable, has_uploaded_files: false };

	expect(chartListHelpers.isPreviewable(previewable)).toBe(true);
	expect(chartListHelpers.isPreviewable(unpublished)).toBe(false);
	expect(chartListHelpers.isPreviewable(withoutUpload)).toBe(false);

	expect(chartListHelpers.chartTitleHref(previewable, true)).toBe('/preview/1');
	expect(chartListHelpers.chartTitleHref(unpublished, true)).toBeNull();
	expect(chartListHelpers.chartTitleHref(withoutUpload, true)).toBeNull();
	expect(chartListHelpers.chartTitleHref(previewable, false)).toBe('/editor/1');
	expect(chartListHelpers.chartTitleHref(unpublished, false)).toBe('/editor/1');
	expect(chartListHelpers.chartTitleHref(withoutUpload, false)).toBeNull();
});
```

- [ ] **Step 2: Run helper test and verify failure**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartList.test.ts
```

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Add the minimal pure helpers**

In `ChartList.helpers.ts`:

```ts
export type ChartNavigationItem = {
	id?: number;
	is_published?: boolean;
	has_uploaded_files?: boolean;
};

export const isPreviewable = (item: ChartNavigationItem): boolean =>
	item.id !== undefined &&
	item.is_published === true &&
	item.has_uploaded_files === true;

export const chartTitleHref = (
	item: ChartNavigationItem,
	isBlog: boolean
): string | null => {
	if (item.id === undefined) return null;
	if (isBlog) return isPreviewable(item) ? `/preview/${item.id}` : null;
	return item.has_uploaded_files === true ? `/editor/${item.id}` : null;
};
```

- [ ] **Step 4: Add card wiring/action tests**

In `ChartListItem.test.ts` add:

```ts
it('routes a previewable blog card title to preview', () => {
	render(ChartListItem, { props: { ...renderProps, isBlog: true, item: mockItem } });
	expect(screen.getByRole('link', { name: 'Test Song 1' })).toHaveAttribute(
		'href',
		'/preview/1'
	);
});

it('keeps an owner card title editor-first', () => {
	render(ChartListItem, { props: renderProps });
	expect(screen.getByRole('link', { name: 'Test Song 1' })).toHaveAttribute(
		'href',
		'/editor/1'
	);
});

it('does not fall back to editor for a non-previewable blog card', () => {
	render(ChartListItem, {
		props: { ...renderProps, isBlog: true, item: { ...mockItem, is_published: false } }
	});
	expect(screen.queryByRole('link', { name: 'Test Song 1' })).not.toBeInTheDocument();
});

it('shows owner Preview and Edit details actions for a published uploaded chart', () => {
	render(ChartListItem, { props: renderProps });
	// PopoverStub always renders its content; no trigger click is required.
	expect(screen.getByRole('menuitem', { name: 'preview.open' })).toHaveAttribute(
		'href',
		'/preview/1'
	);
	expect(screen.getByRole('menuitem', { name: 'Edit details' })).toHaveAttribute(
		'href',
		'/app/chart/1'
	);
});
```

Also assert an explicit blog Preview CTA exists for previewable cards.

- [ ] **Step 5: Use the helpers in `ChartListItem.svelte`**

Import:

```ts
import { chartTitleHref, isPreviewable } from '$lib/components/ChartList.helpers';
```

Derive:

```ts
const hasUploadedChart = $derived(item.id !== undefined && item.has_uploaded_files === true);
const previewable = $derived(isPreviewable(item));
const titleHref = $derived(chartTitleHref(item, isBlog));
```

Render the title from `titleHref`. Keep `handleOpenInEditor()` gated by `hasUploadedChart`.

In owner mode, add a Preview menu item only when `previewable`, and rename the existing `/app/chart/${item.id}` action from `Edit` to `Edit details`.

In the blog footer, add before the existing download action:

```svelte
{#if previewable}
	<a
		href={`/preview/${item.id}`}
		class="music-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
	>
		{$_('preview.open')}
	</a>
{/if}
```

Do not change download eligibility or URLs.

- [ ] **Step 6: Verify Task 4 completely**

```bash
bun run --filter=dtx-web test -- \
  src/lib/components/ChartList.test.ts \
  src/lib/components/ChartListItem.test.ts
bun run --filter=dtx-web check
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add packages/dtx-web/src/lib/components/ChartList.helpers.ts \
  packages/dtx-web/src/lib/components/ChartList.test.ts \
  packages/dtx-web/src/lib/components/ChartListItem.svelte \
  packages/dtx-web/src/lib/components/ChartListItem.test.ts
git commit -m "feat(web): route chart cards by context"
```

---

### Task 5: Apply the shared navigation rules to table view

**Files:**
- Modify: `packages/dtx-web/src/lib/components/ChartList.svelte`
- Modify: `packages/dtx-web/src/lib/components/ChartListTableItem.svelte`
- Test: `packages/dtx-web/src/lib/components/ChartList.test.ts`
- Modify existing: `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`

**Interfaces:**
- Consumes: `chartTitleHref()` / `isPreviewable()` from Task 4.
- Produces: blog table title `/preview/[id]`, owner table title `/editor/[id]`, compact public Preview action, and owner Preview/Edit-details actions.

- [ ] **Step 1: Add lightweight table-title integration tests**

In `ChartList.test.ts`:

```ts
const renderSingleChartInTableMode = async (isBlog: boolean) => {
	mockApi.listSimfiles.mockResolvedValue({ data: [mockListedChart], count: 1 });
	render(ChartList, { props: { isBlog } });
	await screen.findByText(mockListedChart.title);
	await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
};

it('wires the blog table title to preview', async () => {
	await renderSingleChartInTableMode(true);
	expect(screen.getByRole('link', { name: /Test Song 1/ })).toHaveAttribute(
		'href',
		'/preview/1'
	);
});

it('wires the owner table title to editor', async () => {
	await renderSingleChartInTableMode(false);
	expect(screen.getByRole('link', { name: /Test Song 1/ })).toHaveAttribute(
		'href',
		'/editor/1'
	);
});
```

The defensive unpublished/no-upload matrix remains in the pure helper test; do not duplicate it here.

- [ ] **Step 2: Extend the existing `ChartListTableItem.test.ts`**

Preserve its current Tooltip/Popover/toaster/API mocks and delete/navigation tests. Change its existing assertion:

```ts
expect(screen.getByRole('menuitem', { name: 'Edit details' })).toBeInTheDocument();
```

Add:

```ts
it('shows a compact Preview link in blog mode for a previewable chart', () => {
	render(ChartListTableItem, {
		props: {
			...defaultProps,
			isBlog: true,
			item: { ...mockItem, is_published: true }
		}
	});

	expect(screen.getByRole('link', { name: 'preview.open' })).toHaveAttribute(
		'href',
		'/preview/10'
	);
});

it('shows Preview and Edit details in owner mode for a published uploaded chart', () => {
	render(ChartListTableItem, {
		props: { ...defaultProps, item: { ...mockItem, is_published: true } }
	});

	// PopoverStub always renders its content.
	expect(screen.getByRole('menuitem', { name: 'preview.open' })).toHaveAttribute(
		'href',
		'/preview/10'
	);
	expect(screen.getByRole('menuitem', { name: 'Edit details' })).toHaveAttribute(
		'href',
		'/app/chart/10'
	);
});
```

- [ ] **Step 3: Run table tests and verify failures**

```bash
bun run --filter=dtx-web test -- \
  src/lib/components/ChartList.test.ts \
  src/lib/components/ChartListTableItem.test.ts
```

Expected: FAIL on contextual title routing, copy, and Preview actions.

- [ ] **Step 4: Use `chartTitleHref()` for table titles**

Import `chartTitleHref` from `ChartList.helpers.ts` and derive inside the table `#each`:

```svelte
{@const titleHref = chartTitleHref(item, isBlog)}
```

Render a link only when `titleHref` is non-null. A defensive unpublished blog row remains non-clickable.

- [ ] **Step 5: Use `isPreviewable()` with a distinct Preview icon**

In `ChartListTableItem.svelte`:

```ts
import { EllipsisVertical, ExternalLink, Eye } from '@lucide/svelte/icons';
import { isPreviewable } from '$lib/components/ChartList.helpers';
import { _ } from 'svelte-i18n';

const previewable = $derived(isPreviewable(item));
```

Owner mode: add Preview after **Open in Editor** and rename **Edit** -> **Edit details**.

Blog mode: render Preview and current download/external action side-by-side; use `Eye` only for Preview:

```svelte
{#if previewable}
	<a
		href={`/preview/${item.id}`}
		class="inline-flex items-center justify-center rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200"
		aria-label={$_('preview.open')}
		title={$_('preview.open')}
	>
		<Eye size="16" />
	</a>
{/if}
```

Keep `ExternalLink` for external download/unavailable state and do not change download semantics.

- [ ] **Step 6: Verify Task 5 completely**

```bash
bun run --filter=dtx-web test -- \
  src/lib/components/ChartList.test.ts \
  src/lib/components/ChartListItem.test.ts \
  src/lib/components/ChartListTableItem.test.ts
bun run --filter=dtx-web check
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add packages/dtx-web/src/lib/components/ChartList.svelte \
  packages/dtx-web/src/lib/components/ChartList.test.ts \
  packages/dtx-web/src/lib/components/ChartListTableItem.svelte \
  packages/dtx-web/src/lib/components/ChartListTableItem.test.ts
git commit -m "feat(web): route chart table actions by context"
```

---

### Task 6: Verify real VexFlow tempo rendering and Blog -> Preview navigation

**Files:**
- Create: `packages/e2e-web/fixtures/preview-tempo.dtx`
- Modify: `packages/e2e-web/preview.spec.ts`
- Modify: `packages/e2e-web/blog.spec.ts`
- Leave unchanged: `packages/e2e-web/fixtures/test-sample.dtx`

**Interfaces:**
- Consumes: existing seeded published chart `CHART_B_ID = 1002`, `CHART_B_TITLE = 'E2E Download Chart'`, and preview.spec's R2 request interception.
- Produces: browser-level real-rendering coverage without changing shared converter/upload fixtures.

- [ ] **Step 1: Create a preview-only DTX fixture with real playable note lines**

Create `fixtures/preview-tempo.dtx`:

```dtx
#TITLE:Test Preview Tempo Song
#ARTIST:Test Artist
#BPM:120
#BPMAA:180
#DLEVEL:5
#COMMENT:Preview-only DTX fixture for VexFlow tempo rendering

#00011: 01010101
#00112: 00010001
#00211: 01010101
#00208: AA
#00313: 01000100
```

Every playable line starts with `#NNNCC:` so `DTXFile.parseNotes()` actually parses notes. Measure 2 contains both playable hi-hat notes and the channel `08` tempo change, exercising tempo rendering in a non-empty measure.

Do not modify `fixtures/test-sample.dtx`.

- [ ] **Step 2: Point only `preview.spec.ts` at the dedicated fixture**

Change:

```ts
const dtxFixture = path.join(__dirname, 'fixtures', 'preview-tempo.dtx');
```

Keep the existing `page.route('https://chart.hapadona.com/**', ...)` interception unchanged.

- [ ] **Step 3: Add real-VexFlow tempo assertions**

Add:

```ts
test('renders the starting tempo and a channel-08 tempo change', async ({ page }) => {
	const container = page.getByTestId('notation-container');
	await expect(container).toBeVisible({ timeout: 15000 });

	const svgText = container.locator('svg text');
	await expect(svgText.filter({ hasText: '= 120' })).toHaveCount(1);
	await expect(svgText.filter({ hasText: '= 180' })).toHaveCount(1);
});
```

If VexFlow groups text differently, inspect text contents inside `container.locator('svg text')`; do not assert exact x/y positions and do not snapshot SVG.

The existing preview E2E still exercises real VexFlow rendering; the valid fixture now ensures the tempo assertion runs alongside real playable notes rather than three rest-only measures.

- [ ] **Step 4: Add Blog -> Preview navigation coverage**

Update `blog.spec.ts` imports:

```ts
import { CHART_B_ID, CHART_B_TITLE } from './test-config';
```

Add:

```ts
test('opens a published uploaded chart in the public notation preview', async ({ page }) => {
	const chartLink = page.getByRole('link', { name: CHART_B_TITLE }).first();
	await expect(chartLink).toHaveAttribute('href', `/preview/${CHART_B_ID}`);
	await chartLink.click();
	await expect(page).toHaveURL(PAGES.PREVIEW(CHART_B_ID));
});
```

- [ ] **Step 5: Run focused browser coverage**

```bash
bun run --filter=dtx-e2e-web e2e -- preview.spec.ts blog.spec.ts
bun run --filter=dtx-e2e-web check
```

Expected: PASS.

- [ ] **Step 6: Run final touched-package regression checks**

```bash
bun run --filter=@dtx/common test
bun run --filter=@dtx/common check
bun run --filter=@dtx/common build
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-e2e-web check
```

Expected: all PASS.

- [ ] **Step 7: Inspect final scope**

```bash
git diff main...HEAD -- \
  packages/common/src/lib/notation \
  packages/dtx-web/src/lib/components \
  packages/dtx-web/src/routes/preview \
  packages/e2e-web
```

Confirm there are no implementation changes under GraphQL/API, auth, desktop, editor navigation, Phaser preview, or unrelated components.

- [ ] **Step 8: Commit Task 6**

```bash
git add packages/e2e-web/fixtures/preview-tempo.dtx \
  packages/e2e-web/preview.spec.ts \
  packages/e2e-web/blog.spec.ts
git commit -m "test(e2e): cover preview tempo and blog navigation"
```

---

## Final Acceptance Checklist

- [ ] Every task's relevant package `check` command passes before its commit.
- [ ] `ChartTiming.tempoEvents` is the source used by both forward and inverse timing.
- [ ] The timing engine initializes from `ChartTiming.tempoEvents[0].bpm`, not raw `input.bpm`.
- [ ] `NotationChart.tempoEvents` equals `ChartTiming.tempoEvents` by value; array aliasing is not required.
- [ ] Base BPM, channel `08`, and channel `03` changes normalize correctly.
- [ ] Exact channel `08`/`03` ties use the documented input-order rule.
- [ ] Invalid/unresolved tempo values never create bogus marks or infinite duration.
- [ ] Adjacent measures in the same system have one visible boundary, achieved by suppressing the later stave's begin bar only.
- [ ] Existing cursor/seek behavior remains passing after the begin-bar geometry shift.
- [ ] Downbeat and mid-measure BPM changes render through VexFlow `StaveTempo` outside the rhythmic voice.
- [ ] Tempo annotation failures remain non-fatal.
- [ ] Multiple same-measure tempo labels are accepted as a known collision limitation; no new layout engine is added.
- [ ] Blog card title/Preview CTA target `/preview/[id]` only when previewable.
- [ ] Blog table title/action target `/preview/[id]` only when previewable.
- [ ] Non-previewable blog items never fall back to `/editor/[id]`.
- [ ] Owner card/table titles remain `/editor/[id]` for uploaded charts.
- [ ] Owner secondary Preview appears only for published + uploaded charts.
- [ ] Owner metadata action is `Edit details` -> `/app/chart/[id]`.
- [ ] `preview-tempo.dtx` contains valid `#NNNCC:` playable lines and the shared `test-sample.dtx` remains unchanged.
- [ ] Public preview and editor-shell navigation remain unchanged.
- [ ] No API/GraphQL/database/auth/desktop/Phaser changes are present.
