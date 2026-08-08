# HPA-537 Preview Notation and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render measure boundaries and effective BPM changes in the public notation preview, while routing public blog users to Preview and owner chart-management users to Editor.

**Architecture:** Normalize DTX tempo changes once in `@dtx/common`, expose that sequence as `ChartTiming.tempoEvents`, and copy the exact same array into `NotationChart` for VexFlow rendering. Render all tempo marks through VexFlow's `StaveTempo` after the stave itself is drawn so annotation failures stay isolated from notation layout. Keep navigation contextual, but centralize the small route predicate in existing `ChartList.helpers.ts` so card, table title, and table actions cannot drift.

**Tech Stack:** TypeScript 5.x, Svelte 5 / SvelteKit 2.x, VexFlow 4.2.5, Vitest, Testing Library, Playwright, Bun workspaces.

## Global Constraints

- No database, GraphQL, API, auth, or codegen changes.
- No desktop/Tauri or Phaser gameplay-preview changes.
- No generic notation-event framework; add only `NotationTempoEvent`.
- `ChartTiming.tempoEvents` is the single normalized effective tempo sequence used by both timing and notation.
- The first normalized tempo event is also the timing engine's initial BPM; do not separately initialize timing from raw `input.bpm`.
- Support base BPM, channel `08` (`#BPMxx`) changes, and legacy channel `03` direct-hex changes.
- Exact-position ties preserve input order; `buildNotationChart()` supplies channel `08` before converted channel `03`, so channel `03` wins an exact tie.
- Invalid, non-finite, non-positive, or unresolved BPM changes are ignored and retain the prior effective tempo.
- Consecutive effective events with the same BPM are collapsed.
- Every measure gets one explicit VexFlow end bar; following measures in the same system do not add a duplicate beginning bar.
- All BPM markings use VexFlow `StaveTempo`; they must not participate in the rhythmic `Voice`, alter note spacing, or affect cursor geometry.
- Public blog navigation targets `/preview/[id]`; owner chart-list navigation targets `/editor/[id]`.
- A blog item that is not previewable stays non-clickable; it must never fall back to Editor.
- Do not add Editor actions to the public preview or Preview actions to the editor shell.
- Do not create a shared `ChartActions` UI component; only reuse pure route predicates.
- Follow TDD and commit after each independently reviewable task.

---

## File Structure

### Shared notation/timing

- `packages/common/src/lib/notation/model.ts`
  - Owns `NotationTempoEvent` and `NotationChart.tempoEvents`.
- `packages/common/src/lib/notation/timing.ts`
  - Owns `normalizeTempoEvents()` and uses the result for forward/inverse timing.
- `packages/common/src/lib/notation/timing.test.ts`
  - Owns normalization and timing invariants independent of DTX parsing.
- `packages/common/src/lib/notation/quantize.ts`
  - Keeps existing channel `03` synthetic-key conversion, calls `buildChartTiming()`, and exposes the same `tempoEvents` array on `NotationChart`.
- `packages/common/src/lib/notation/quantize.test.ts`
  - Owns DTX integration coverage for channels `08` / `03`, exact-tie ordering, and chart/timing identity.

### Web preview rendering

- `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
  - Owns VexFlow stave barlines and tempo annotations.
- `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
  - Owns happy-path renderer orchestration with VexFlow mocked.
- `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`
  - Keeps the error-path VexFlow mock compatible and verifies tempo annotation failure remains non-fatal.
- `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`
  - Updates existing chart/timing fixtures for the required `tempoEvents` fields; no new page-level BPM behavior test.

### Navigation

- `packages/dtx-web/src/lib/components/ChartList.helpers.ts`
  - Existing helper module; add only `isPreviewable()` and `chartTitleHref()` pure navigation helpers.
- `packages/dtx-web/src/lib/components/ChartList.test.ts`
  - Test the navigation matrix once at the pure-helper seam and keep one table-title integration check per context.
- `packages/dtx-web/src/lib/components/ChartListItem.svelte`
  - Uses the helper for card title destination and Preview visibility.
- `packages/dtx-web/src/lib/components/ChartListItem.test.ts`
  - Verifies card wiring and explicit Preview/Edit-details actions.
- `packages/dtx-web/src/lib/components/ChartList.svelte`
  - Uses `chartTitleHref()` for table-row title destination because the table title markup lives here.
- `packages/dtx-web/src/lib/components/ChartListTableItem.svelte`
  - Uses `isPreviewable()` for compact table actions and uses a distinct Preview icon.
- `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`
  - **Existing test file.** Extend its current navigation/download/delete coverage and update the existing `Edit` assertion to `Edit details`; do not recreate or replace its mock setup.

### Browser coverage

- `packages/e2e-web/fixtures/preview-tempo.dtx`
  - New preview-specific fixture containing a channel `08` tempo change.
- `packages/e2e-web/preview.spec.ts`
  - Switches only this spec's R2 interception to `preview-tempo.dtx` and verifies real VexFlow tempo text.
- `packages/e2e-web/blog.spec.ts`
  - Verifies the published seeded chart navigates from Blog to `/preview/[id]`.
- `packages/e2e-web/fixtures/test-sample.dtx`
  - **Unchanged.** It remains shared by converter/upload specs and `setup/prepare-stack.ts`.

---

## Implementation Risks

- **VexFlow enum values:** in VexFlow 4.2.5, `BarlineType.SINGLE === 1` and `BarlineType.NONE === 7`; mocks must use the real values and production code must use enum members, never numeric literals.
- **StaveTempo context:** construct/draw tempo marks only after the stave has a context and base notation has rendered; catch each annotation independently.
- **SVG text selector:** the Playwright assertion relies on VexFlow's SVG backend exposing `StaveTempo` `fillText()` output as text nodes. If the exact `getByText` selector is brittle, inspect only the notation container's SVG `<text>` nodes rather than snapshotting SVG.
- **Barline defaults:** a `Stave` starts with both left/right single bars; explicitly suppress only non-first-in-row begin bars to avoid doubled adjacent boundaries.
- **Existing navigation tests:** `ChartListTableItem.test.ts` already asserts `Edit`; update that assertion in the same task as the copy rename.
- **Fixture isolation:** do not add tempo directives to shared `test-sample.dtx`; use the dedicated preview fixture to avoid converter/upload test blast radius.

---

### Task 1: Normalize effective tempo once in `ChartTiming`

**Files:**
- Modify: `packages/common/src/lib/notation/model.ts`
- Modify: `packages/common/src/lib/notation/timing.ts`
- Test: `packages/common/src/lib/notation/timing.test.ts`

**Interfaces:**
- Consumes: existing `TimingInput { bpm, bpmValueMap, bpmChanges, measureLengths, measureCount }`.
- Produces: `NotationTempoEvent`, `normalizeTempoEvents(input): NotationTempoEvent[]`, and `ChartTiming.tempoEvents: NotationTempoEvent[]`.
- Later tasks rely on `ChartTiming.tempoEvents` being the exact sequence used by `positionToTime()` and `timeToPosition()`.

- [ ] **Step 1: Add failing normalization tests**

Extend the import in `timing.test.ts`:

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
	const t = buildChartTiming({
		bpm: Number.NaN,
		bpmValueMap: {},
		bpmChanges: [],
		measureLengths: [1],
		measureCount: 1
	});

	expect(t.tempoEvents).toEqual([{ measure: 0, fraction: 0, bpm: 120 }]);
	expect(t.totalDuration).toBe(2);
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

	const events = normalizeTempoEvents({
		bpm: 120,
		bpmValueMap: { AA: 180, BB: 240 },
		bpmChanges,
		measureLengths: [1],
		measureCount: 1
	});

	expect(events).toEqual([{ measure: 0, fraction: 0, bpm: 240 }]);
});

it('ignores unresolved and non-positive bpm changes for both events and duration', () => {
	const bpmChanges = [
		new LaneMeasureNote(0, '08', [
			{ noteID: 'MISSING', position: 0.25 },
			{ noteID: 'ZERO', position: 0.5 },
			{ noteID: 'NEG', position: 0.75 }
		])
	];

	const t = buildChartTiming({
		bpm: 120,
		bpmValueMap: { ZERO: 0, NEG: -10 },
		bpmChanges,
		measureLengths: [1],
		measureCount: 1
	});

	expect(t.tempoEvents).toEqual([{ measure: 0, fraction: 0, bpm: 120 }]);
	// A mapped 0 BPM currently poisons duration through 60 / bpm. Normalization
	// intentionally changes that behavior: invalid changes are no-ops.
	expect(t.totalDuration).toBe(2);
});
```

Extend the existing mid-measure round-trip test with:

```ts
expect(t.tempoEvents).toEqual([
	{ measure: 0, fraction: 0, bpm: 120 },
	{ measure: 0, fraction: 0.5, bpm: 240 }
]);
```

- [ ] **Step 2: Run the timing tests and verify they fail**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts
```

Expected: FAIL because `normalizeTempoEvents` and `ChartTiming.tempoEvents` do not exist.

- [ ] **Step 3: Add the narrow notation tempo type**

In `model.ts`:

```ts
export interface NotationTempoEvent {
	measure: number;
	fraction: number;
	bpm: number;
}

export interface NotationChart {
	measures: NotationMeasure[];
	tempoEvents: NotationTempoEvent[];
}
```

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

- [ ] **Step 5: Make forward and inverse timing consume the normalized sequence**

Refactor `secondsIntoMeasure()` so it accepts `measureLength`, `startBpm`, and `tempoEvents` rather than resolving raw `input.bpmChanges`:

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

Build `fractionAtSeconds()` bounds from the same sequence:

```ts
const bounds = tempoEvents.filter(
	(event) => event.measure === measure && event.fraction >= 0 && event.fraction < 1
);
```

Initialize `buildChartTiming()` from the normalized initial event, not raw `input.bpm`:

```ts
const tempoEvents = normalizeTempoEvents(input);
const initialBpm = tempoEvents[0]?.bpm ?? 120;
const measureStartSeconds: number[] = [];
const measureBpmAtStart: number[] = [];
let elapsed = 0;
let bpm = initialBpm;
```

Use `initialBpm` as the fallback in both public conversion functions:

```ts
const startBpm = measureBpmAtStart[measure] ?? initialBpm;
```

Return the sequence:

```ts
return {
	tempoEvents,
	measureStartSeconds,
	totalDuration,
	positionToTime,
	timeToPosition
};
```

Update the interface:

```ts
export interface ChartTiming {
	tempoEvents: NotationTempoEvent[];
	measureStartSeconds: number[];
	totalDuration: number;
	positionToTime(measure: number, fraction: number): number;
	timeToPosition(t: number): { measure: number; fraction: number };
}
```

- [ ] **Step 6: Run timing tests**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts
```

Expected: PASS, including the mapped-zero duration regression plus existing downbeat and mid-measure round trips.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/common/src/lib/notation/model.ts \
  packages/common/src/lib/notation/timing.ts \
  packages/common/src/lib/notation/timing.test.ts
git commit -m "feat(common): normalize preview tempo events"
```

---

### Task 2: Expose DTX channel `03` / `08` tempo events through `NotationChart`

**Files:**
- Modify: `packages/common/src/lib/notation/quantize.ts`
- Test: `packages/common/src/lib/notation/quantize.test.ts`
- Test fixture update: `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`

**Interfaces:**
- Consumes: `ChartTiming.tempoEvents` from Task 1.
- Produces: `buildNotationChart(dtx).chart.tempoEvents`, using the same array reference as `timing.tempoEvents`.
- Preserves the existing channel `03` conversion to synthetic `03:${noteID}` map keys.

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
	expect(chart.tempoEvents).toBe(timing.tempoEvents);
});

it('exposes legacy channel 03 changes and lets channel 03 win an exact tie', () => {
	const dtx = makeDtx(['#BPMAA: 180', '#00108: AA', '#00103: F0'], 120);
	const { chart, timing } = buildNotationChart(dtx);

	expect(chart.tempoEvents).toEqual([
		{ measure: 0, fraction: 0, bpm: 120 },
		{ measure: 1, fraction: 0, bpm: 240 }
	]);
	expect(chart.tempoEvents).toBe(timing.tempoEvents);
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

- [ ] **Step 2: Run the quantize tests and verify they fail**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/quantize.test.ts
```

Expected: FAIL because `NotationChart` does not yet receive `timing.tempoEvents`.

- [ ] **Step 3: Wire the exact timing sequence into the chart**

Keep the existing legacy-channel conversion block intact. Change only the returned chart after `buildChartTiming()`:

```ts
const timing = buildChartTiming({
	bpm: dtx.bpm || 120,
	bpmValueMap,
	bpmChanges: [...(notesByLane[BPM_CHANNEL] ?? []), ...legacyBpmChanges],
	measureLengths,
	measureCount
});

return {
	chart: { measures, tempoEvents: timing.tempoEvents },
	timing,
	notesByLane,
	measureCount
};
```

Do not parse tempo a second time in `buildNotationChart()`.

- [ ] **Step 4: Keep preview-page fixtures structurally complete**

In `preview-page.test.ts`, update `readyChart()` so both model fixtures include tempo data and share the same array:

```ts
const readyChart = () => {
	const tempoEvents = [{ measure: 0, fraction: 0, bpm: 120 }];
	return {
		chart: {
			measures: [
				{ index: 0, measureTicks: 192, beatsPerMeasure: 4, entries: [], tuplets: [] }
			],
			tempoEvents
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

Do not add a page test that merely reasserts `chart = built.chart`; existing page behavior tests are sufficient.

- [ ] **Step 5: Run common and preview-page tests**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts src/lib/notation/quantize.test.ts
bun run --filter=dtx-web test -- src/routes/preview/[id]/preview-page.test.ts
bun run --filter=@dtx/common build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/common/src/lib/notation/quantize.ts \
  packages/common/src/lib/notation/quantize.test.ts \
  packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts
git commit -m "feat(common): expose notation tempo events"
```

---

### Task 3: Render measure boundaries and BPM markings in VexFlow

**Files:**
- Modify: `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
- Test: `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
- Test: `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`

**Interfaces:**
- Consumes: `chart.tempoEvents: NotationTempoEvent[]` from Task 2.
- Produces: one end bar per measure and isolated VexFlow `StaveTempo` annotations.
- Uses VexFlow 4.2.5 exports `BarlineType` and `StaveTempo`.

- [ ] **Step 1: Extend the happy-path VexFlow mock and add failing tests**

In `NotationView.test.ts`, add captures:

```ts
const begBarTypes = vi.hoisted(() => [] as number[]);
const endBarTypes = vi.hoisted(() => [] as number[]);
const tempoCalls = vi.hoisted(
	() => [] as Array<{ x: number; bpm?: number; duration?: string }>
);
```

Extend mocked `Stave`:

```ts
setBegBarType(type: number) {
	begBarTypes.push(type);
	return this;
}
setEndBarType(type: number) {
	endBarTypes.push(type);
	return this;
}
```

Add the real VexFlow 4.2.5 enum values and tempo mock:

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

After the VexFlow mock, import the mocked enum for assertions:

```ts
import { BarlineType } from 'vexflow';
```

Add `tempoEvents: []` to every `NotationChart` fixture in this file unless the test supplies explicit events.

Add:

```ts
it('renders one end bar per measure and suppresses duplicate begin bars within a row', async () => {
	const twoMeasureChart: NotationChart = {
		measures: [chart.measures[0], { ...chart.measures[0], index: 1 }],
		tempoEvents: []
	};

	render(NotationView, { props: { chart: twoMeasureChart } });
	await tick();

	expect(endBarTypes).toEqual([BarlineType.SINGLE, BarlineType.SINGLE]);
	expect(begBarTypes[0]).toBe(BarlineType.SINGLE);
	expect(begBarTypes[1]).toBe(BarlineType.NONE);
});

it('renders a measure-start tempo with VexFlow StaveTempo', async () => {
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0, bpm: 120 }]
	};

	render(NotationView, { props: { chart: tempoChart } });
	await tick();

	expect(tempoCalls).toContainEqual({ x: 30, bpm: 120, duration: 'q' });
});

it('renders a mid-measure tempo at proportional stave x without adding voice notes', async () => {
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0.5, bpm: 180 }]
	};

	render(NotationView, { props: { chart: tempoChart } });
	await tick();

	expect(tempoCalls).toContainEqual({ x: 115, bpm: 180, duration: 'q' });
	expect(staveNoteArgs).toHaveLength(chart.measures[0].entries.length);
});
```

The mocked note range is `30..200`, so fraction `0.5` resolves to x `115`. Clear all new capture arrays in `beforeEach()`.

- [ ] **Step 2: Update the error-path VexFlow mock**

In `NotationView.errors.test.ts`, add:

```ts
let throwTempoDraw = false;
```

Extend mocked `Stave`:

```ts
setBegBarType() {
	return this;
}
setEndBarType() {
	return this;
}
```

Add the correct enum values and a throwing tempo mock:

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

Add `tempoEvents: []` to its base chart fixture and reset `throwTempoDraw = false` in `beforeEach()`.

- [ ] **Step 3: Run renderer tests and verify the new assertions fail**

```bash
bun run --filter=dtx-web test -- src/lib/components/preview/NotationView.test.ts src/lib/components/preview/NotationView.errors.test.ts
```

Expected: new barline/tempo assertions FAIL because the component does not call these APIs yet.

- [ ] **Step 4: Import and apply VexFlow barline APIs**

Change the production import:

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
stave.setBegBarType(firstInRow ? BarlineType.SINGLE : BarlineType.NONE);
stave.setEndBarType(BarlineType.SINGLE);
```

Never substitute numeric `0` for `BarlineType.NONE`; VexFlow 4.2.5 defines `NONE` as `7`.

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

After `voice.draw()`, beams, and tuplets are drawn:

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

This deliberately uses one post-draw path for both measure-start and mid-measure marks. Do not put `StaveTempo` into the stave modifier list or rhythmic `Voice`; an annotation failure must not invalidate base notation.

Increase only fixed vertical headroom:

```ts
const SYSTEM_HEIGHT = 160;
const TOP = 30;
```

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

- [ ] **Step 8: Run renderer tests and Svelte checking**

```bash
bun run --filter=dtx-web test -- src/lib/components/preview/NotationView.test.ts src/lib/components/preview/NotationView.errors.test.ts
bun run --filter=dtx-web check
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add packages/dtx-web/src/lib/components/preview/NotationView.svelte \
  packages/dtx-web/src/lib/components/preview/NotationView.test.ts \
  packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts
git commit -m "feat(web): render preview tempo and measure lines"
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
- Card, table title, and table actions all consume the same predicates.
- No shared UI/action component is introduced.

- [ ] **Step 1: Add the failing pure navigation matrix to the existing helper tests**

In the existing `ChartList helpers` describe in `ChartList.test.ts`, add:

```ts
it('derives chart title destinations from public-vs-owner context', () => {
	const previewable = {
		id: 1,
		is_published: true,
		has_uploaded_files: true
	};
	const unpublished = { ...previewable, is_published: false };
	const withoutUpload = { ...previewable, has_uploaded_files: false };

	expect(chartListHelpers.isPreviewable(previewable)).toBe(true);
	expect(chartListHelpers.chartTitleHref(previewable, true)).toBe('/preview/1');
	expect(chartListHelpers.chartTitleHref(previewable, false)).toBe('/editor/1');
	expect(chartListHelpers.chartTitleHref(unpublished, true)).toBeNull();
	expect(chartListHelpers.chartTitleHref(unpublished, false)).toBe('/editor/1');
	expect(chartListHelpers.chartTitleHref(withoutUpload, true)).toBeNull();
	expect(chartListHelpers.chartTitleHref(withoutUpload, false)).toBeNull();
	expect(chartListHelpers.chartTitleHref({ has_uploaded_files: true }, false)).toBeNull();
});
```

- [ ] **Step 2: Run helper tests and verify failure**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartList.test.ts
```

Expected: FAIL because the two helpers do not exist.

- [ ] **Step 3: Implement the two small pure helpers**

Append to `ChartList.helpers.ts`:

```ts
export type ChartNavigationItem = {
	id?: number;
	is_published?: boolean;
	has_uploaded_files?: boolean;
};

export const isPreviewable = (item: ChartNavigationItem): boolean =>
	item.id !== undefined && item.is_published === true && item.has_uploaded_files === true;

export const chartTitleHref = (item: ChartNavigationItem, isBlog: boolean): string | null => {
	if (item.id === undefined) return null;
	if (isBlog) return isPreviewable(item) ? `/preview/${item.id}` : null;
	return item.has_uploaded_files === true ? `/editor/${item.id}` : null;
};
```

Do not add auth/ownership parameters; the caller's `isBlog` context is the intended policy boundary.

- [ ] **Step 4: Add failing card wiring tests**

In `ChartListItem.test.ts`, add/adjust only integration-level checks; the full matrix is already covered by the helper test:

```ts
it('routes a previewable blog card title to the public preview', () => {
	render(ChartListItem, { props: { ...renderProps, isBlog: true, item: mockItem } });
	expect(screen.getByRole('link', { name: 'Test Song 1' })).toHaveAttribute(
		'href',
		'/preview/1'
	);
});

it('keeps an uploaded owner card title pointed at the editor', () => {
	render(ChartListItem, { props: renderProps });
	expect(screen.getByRole('link', { name: 'Test Song 1' })).toHaveAttribute(
		'href',
		'/editor/1'
	);
});

it('does not render a title link for a non-previewable blog card', () => {
	render(ChartListItem, {
		props: {
			...renderProps,
			isBlog: true,
			item: { ...mockItem, has_uploaded_files: false }
		}
	});
	expect(screen.queryByRole('link', { name: 'Test Song 1' })).not.toBeInTheDocument();
});

it('shows an explicit Preview action on previewable blog cards', () => {
	render(ChartListItem, { props: { ...renderProps, isBlog: true } });
	expect(
		screen.getAllByRole('link', { name: 'preview.open' }).some(
			(link) => link.getAttribute('href') === '/preview/1'
		)
	).toBe(true);
});

it('shows owner Preview and Edit details actions for a published uploaded chart', async () => {
	render(ChartListItem, { props: renderProps });
	await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

	expect(screen.getByRole('link', { name: 'preview.open' })).toHaveAttribute(
		'href',
		'/preview/1'
	);
	expect(screen.getByRole('link', { name: 'Edit details' })).toHaveAttribute(
		'href',
		'/app/chart/1'
	);
});
```

- [ ] **Step 5: Use the pure helpers in `ChartListItem.svelte`**

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

Render the title from `titleHref`:

```svelte
{#if titleHref}
	<a
		href={titleHref}
		class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
	>
		{item.title}
	</a>
{:else}
	{item.title}
{/if}
```

Keep `handleOpenInEditor()` gated by `hasUploadedChart`.

- [ ] **Step 6: Add owner Preview, rename Edit details, and add the blog Preview CTA**

Inside the owner popover after **Open in Editor**:

```svelte
{#if previewable}
	<a
		href={`/preview/${item.id}`}
		class="flex items-center gap-3 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-purple-600/20 hover:text-purple-200"
		role="menuitem"
	>
		{$_('preview.open')}
	</a>
{/if}
```

Change only the text of the existing `/app/chart/${item.id}` action from `Edit` to `Edit details`.

In the blog footer, keep current download behavior and add this adjacent action before it:

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

Wrap Preview + existing download content in the existing footer area with `flex flex-wrap items-center gap-2`; do not change download eligibility or URL semantics.

- [ ] **Step 7: Run card/helper tests and web check**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartList.test.ts src/lib/components/ChartListItem.test.ts
bun run --filter=dtx-web check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

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
- **Modify existing:** `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`

**Interfaces:**
- Consumes: `chartTitleHref()` / `isPreviewable()` from Task 4.
- Produces: blog table title `/preview/[id]`, owner table title `/editor/[id]`, compact public Preview action, and owner Preview/Edit-details actions.

- [ ] **Step 1: Add failing table-title integration tests**

Add to `ChartList.test.ts`:

```ts
const renderSingleChartInTableMode = async (isBlog: boolean) => {
	mockApi.listSimfiles.mockResolvedValue({ data: [mockListedChart], count: 1 });
	render(ChartList, { props: { isBlog } });
	await screen.findByText(mockListedChart.title);
	await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
};

it('uses the shared helper for a previewable blog table title', async () => {
	await renderSingleChartInTableMode(true);
	expect(screen.getByRole('link', { name: /Test Song 1/ })).toHaveAttribute(
		'href',
		'/preview/1'
	);
});

it('uses the shared helper for an owner table title', async () => {
	await renderSingleChartInTableMode(false);
	expect(screen.getByRole('link', { name: /Test Song 1/ })).toHaveAttribute(
		'href',
		'/editor/1'
	);
});
```

The defensive unpublished/no-upload matrix stays in the pure helper test from Task 4; do not duplicate all combinations here.

- [ ] **Step 2: Extend the existing `ChartListTableItem.test.ts` instead of recreating it**

Preserve its current `TooltipStub`, `toastMock`, API mocks, delete tests, and navigation tests. Update this existing assertion in the same change as the label rename:

```ts
expect(screen.getByRole('menuitem', { name: 'Edit details' })).toBeInTheDocument();
```

Add focused action tests:

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

it('hides Preview in blog mode when uploaded files are unavailable', () => {
	render(ChartListTableItem, {
		props: {
			...defaultProps,
			isBlog: true,
			item: { ...mockItem, is_published: true, has_uploaded_files: false }
		}
	});

	expect(screen.queryByRole('link', { name: 'preview.open' })).not.toBeInTheDocument();
});

it('shows Preview and Edit details in the owner action menu for a published uploaded chart', () => {
	render(ChartListTableItem, {
		props: { ...defaultProps, item: { ...mockItem, is_published: true } }
	});

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
bun run --filter=dtx-web test -- src/lib/components/ChartList.test.ts src/lib/components/ChartListTableItem.test.ts
```

Expected: FAIL on contextual title routing, the `Edit details` copy, and missing Preview actions.

- [ ] **Step 4: Use `chartTitleHref()` for table titles in `ChartList.svelte`**

Import:

```ts
import {
	BULK_DOWNLOAD_UNSUPPORTED_MESSAGE,
	MAX_BULK_DOWNLOAD_CHARTS,
	canBulkSelect,
	changePage as getChangedPage,
	handlePageSizeChange as getChangedPageSize,
	isAbortError,
	resetBulkSelection as createEmptySelection,
	startBulkDownload,
	supportsBulkDownloadStreaming as checkBulkDownloadStreaming,
	chartTitleHref
} from '$lib/components/ChartList.helpers';
```

Inside the table-mode `{#each filteredItems as item (item.id)}` block, derive once:

```svelte
{@const titleHref = chartTitleHref(item, isBlog)}
```

Then render:

```svelte
{#if titleHref}
	<a
		href={titleHref}
		class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
	>
		{item.display_id}. {item.title}
	</a>
{:else}
	{item.display_id}. {item.title}
{/if}
```

A defensive unpublished blog row therefore stays non-clickable because the shared helper returns `null`; it never falls back to Editor.

- [ ] **Step 5: Use `isPreviewable()` and a distinct Preview icon in `ChartListTableItem.svelte`**

Change icon imports to include `Eye` while keeping `ExternalLink` for external download only:

```ts
import { EllipsisVertical, ExternalLink, Eye } from '@lucide/svelte/icons';
import { isPreviewable } from '$lib/components/ChartList.helpers';
import { _ } from 'svelte-i18n';
```

Derive:

```ts
const previewable = $derived(isPreviewable(item));
```

In owner mode, add after **Open in Editor**:

```svelte
{#if previewable}
	<a
		href={`/preview/${item.id}`}
		role="menuitem"
		class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
	>
		{$_('preview.open')}
	</a>
{/if}
```

Rename the existing `/app/chart/${item.id}` link text to `Edit details`.

For blog mode, render Preview and the existing download/external action side-by-side:

```svelte
{:else}
	<div class="flex items-center gap-2">
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

		{#if enableDownload}
			<DownloadDropdown
				simfileId={item.id}
				externalUrl={item.download_url ?? null}
				hasUploadedFiles={item.has_uploaded_files}
				compact={true}
			/>
		{:else if item.download_url}
			<a
				href={item.download_url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center justify-center rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200"
				aria-label="External download link"
				title="External download link"
			>
				<ExternalLink size="16" />
			</a>
		{:else}
			<span
				class="inline-flex cursor-not-allowed items-center justify-center rounded-full p-2 text-slate-300 opacity-50"
				aria-disabled="true"
				title="No external link available"
			>
				<ExternalLink size="16" />
			</span>
		{/if}
	</div>
{/if}
```

Do not change download eligibility or URL behavior.

- [ ] **Step 6: Run navigation tests and web checking**

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

### Task 6: Verify real VexFlow tempo rendering and Blog → Preview navigation

**Files:**
- Create: `packages/e2e-web/fixtures/preview-tempo.dtx`
- Modify: `packages/e2e-web/preview.spec.ts`
- Modify: `packages/e2e-web/blog.spec.ts`
- Leave unchanged: `packages/e2e-web/fixtures/test-sample.dtx`

**Interfaces:**
- Consumes: existing seeded published chart `CHART_B_ID = 1002`, `CHART_B_TITLE = 'E2E Download Chart'`, and preview.spec's existing R2 request interception.
- Produces: one browser-level real-rendering check and one public navigation journey without modifying a fixture shared by converter/upload specs.

- [ ] **Step 1: Create a preview-only DTX fixture with a channel `08` change**

Create `fixtures/preview-tempo.dtx`:

```dtx
#TITLE:Test Preview Tempo Song
#ARTIST:Test Artist
#BPM:120
#BPMAA:180
#DLEVEL:5
#COMMENT:Preview-only DTX fixture for VexFlow tempo rendering

#00208: AA
001: 01020300
002: 00000400
003: 01000200
004: 00030000
```

Do not modify `fixtures/test-sample.dtx`; it is shared by `dtx-to-midi.spec.ts`, `dtx-file-upload.spec.ts`, and `setup/prepare-stack.ts`.

- [ ] **Step 2: Point only `preview.spec.ts` at the dedicated fixture**

Change its fixture path:

```ts
const dtxFixture = path.join(__dirname, 'fixtures', 'preview-tempo.dtx');
```

Keep the existing `page.route('https://chart.hapadona.com/**', ...)` interception behavior unchanged.

- [ ] **Step 3: Add the real-VexFlow tempo assertion**

Add:

```ts
test('renders the starting tempo and a channel-08 tempo change', async ({ page }) => {
	const container = page.getByTestId('notation-container');
	await expect(container).toBeVisible({ timeout: 15000 });

	await expect(container.getByText(/= 120/)).toBeVisible();
	await expect(container.getByText(/= 180/)).toBeVisible();
});
```

If VexFlow's SVG backend exposes text in a way `getByText` cannot match reliably, keep the assertion scoped to `container.locator('svg text')` and assert the rendered text contents include both `= 120` and `= 180`. Do not snapshot the SVG.

- [ ] **Step 4: Add Blog → Preview navigation coverage**

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

- [ ] **Step 5: Run focused E2E tests**

Run from repository root; Playwright manages its own web/API/Supabase stack:

```bash
bun run --filter=dtx-e2e-web e2e -- preview.spec.ts blog.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run final regression checks for touched packages**

```bash
bun run --filter=@dtx/common test
bun run --filter=@dtx/common build
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-e2e-web check
```

Expected: all commands PASS.

Because the shared `test-sample.dtx` is unchanged, no extra converter/upload E2E run is required solely for HPA-537 fixture safety.

- [ ] **Step 7: Inspect the final implementation diff for scope creep**

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

- [ ] `ChartTiming.tempoEvents` exists and is the source used by both forward and inverse timing.
- [ ] The timing engine initializes from `ChartTiming.tempoEvents[0].bpm`, not raw `input.bpm`.
- [ ] `NotationChart.tempoEvents === timing.tempoEvents` for `buildNotationChart()` output.
- [ ] Base BPM, channel `08`, and channel `03` changes normalize correctly.
- [ ] Exact channel `08`/`03` ties use the documented input-order rule.
- [ ] Invalid/unresolved/non-positive tempo values never create bogus notation marks or poison duration.
- [ ] Every measure has one explicit end bar and adjacent measures do not double the boundary.
- [ ] VexFlow mocks use `BarlineType.NONE === 7`, matching VexFlow 4.2.5.
- [ ] Downbeat and mid-measure BPM changes render through VexFlow `StaveTempo` outside the rhythmic voice.
- [ ] Tempo annotation failures remain non-fatal.
- [ ] All required `NotationChart` / `ChartTiming` test fixtures include `tempoEvents`.
- [ ] `isPreviewable()` / `chartTitleHref()` own the shared card/table route policy.
- [ ] Blog card title and Preview CTA target `/preview/[id]` only when previewable.
- [ ] Blog table title/action target `/preview/[id]` only when previewable.
- [ ] Non-previewable blog cards/rows never fall back to `/editor/[id]`.
- [ ] Owner card/table titles remain `/editor/[id]` for uploaded charts.
- [ ] Owner secondary Preview appears only for published + uploaded charts.
- [ ] Table Preview uses a distinct `Eye` glyph; `ExternalLink` remains reserved for external download.
- [ ] Owner metadata action is labelled `Edit details` and targets `/app/chart/[id]`.
- [ ] Existing `ChartListTableItem.test.ts` is extended, not recreated.
- [ ] Public preview and editor-shell navigation remain unchanged.
- [ ] Shared `packages/e2e-web/fixtures/test-sample.dtx` remains unchanged.
- [ ] No API/GraphQL/database/auth/desktop/Phaser changes are present.
- [ ] Common unit tests, web unit tests/check, and focused E2E tests pass.
