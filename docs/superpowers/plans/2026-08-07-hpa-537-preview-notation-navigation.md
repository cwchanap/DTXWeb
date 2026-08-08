# HPA-537 Preview Notation and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render measure boundaries and effective BPM changes in the public notation preview, while routing public blog users to Preview and owner chart-management users to Editor.

**Architecture:** Normalize DTX tempo changes once in `@dtx/common`, expose that sequence as `ChartTiming.tempoEvents`, and copy the exact same array into `NotationChart` for VexFlow rendering. Keep navigation contextual inside the existing card/table components: blog mode uses `/preview/[id]`; owner mode keeps `/editor/[id]`, with Preview as a secondary action.

**Tech Stack:** TypeScript 5.x, Svelte 5 / SvelteKit 2.x, VexFlow 4.2.5, Vitest, Testing Library, Playwright, Bun workspaces.

## Global Constraints

- No database, GraphQL, API, auth, or codegen changes.
- No desktop/Tauri or Phaser gameplay-preview changes.
- No generic notation-event framework; add only `NotationTempoEvent`.
- `ChartTiming.tempoEvents` is the single normalized effective tempo sequence used by both timing and notation.
- Support base BPM, channel `08` (`#BPMxx`) changes, and legacy channel `03` direct-hex changes.
- Exact-position ties preserve input order; `buildNotationChart()` supplies channel `08` before converted channel `03`, so channel `03` wins an exact tie.
- Invalid, non-finite, non-positive, or unresolved BPM changes are ignored and retain the prior effective tempo.
- Consecutive effective events with the same BPM are collapsed.
- Every measure gets one explicit VexFlow end bar; following measures do not add a duplicate beginning bar.
- Measure-start tempo marks use VexFlow tempo rendering; mid-measure tempo marks must not participate in the rhythmic voice or alter note spacing.
- Public blog navigation targets `/preview/[id]`; owner chart-list navigation targets `/editor/[id]`.
- Do not add Editor actions to the public preview or Preview actions to the editor shell.
- Follow TDD and commit after each independently reviewable task.

---

## File Structure

### Shared notation/timing

- `packages/common/src/lib/notation/model.ts`
  - Owns `NotationTempoEvent` and the `NotationChart.tempoEvents` field.
- `packages/common/src/lib/notation/timing.ts`
  - Owns `normalizeTempoEvents()` and uses its result for forward/inverse timing.
- `packages/common/src/lib/notation/timing.test.ts`
  - Owns normalization and timing invariants independent of DTX parsing.
- `packages/common/src/lib/notation/quantize.ts`
  - Converts DTX channel `03` into the existing synthetic keys, calls `buildChartTiming()`, and copies `timing.tempoEvents` into `NotationChart`.
- `packages/common/src/lib/notation/quantize.test.ts`
  - Owns DTX integration coverage for channel `08`, channel `03`, exact-tie ordering, and chart/timing identity.

### Web preview rendering

- `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
  - Owns VexFlow stave barlines and tempo annotations.
- `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
  - Owns happy-path renderer orchestration tests with VexFlow mocked.
- `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`
  - Keeps the error-path VexFlow mock compatible and verifies annotation failure remains non-fatal.

### Navigation

- `packages/dtx-web/src/lib/components/ChartListItem.svelte`
  - Owns card title destination and card/menu Preview actions.
- `packages/dtx-web/src/lib/components/ChartListItem.test.ts`
  - Owns card public-vs-owner navigation tests.
- `packages/dtx-web/src/lib/components/ChartList.svelte`
  - Owns table-row title destination because the title markup lives in the parent list.
- `packages/dtx-web/src/lib/components/ChartList.test.ts`
  - Owns table title public-vs-owner navigation tests.
- `packages/dtx-web/src/lib/components/ChartListTableItem.svelte`
  - Owns compact table actions.
- `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`
  - New focused test for table Preview / Edit-details actions because no dedicated test exists today.

### Browser coverage

- `packages/e2e-web/fixtures/test-sample.dtx`
  - Adds a real channel `08` tempo change to the preview fixture.
- `packages/e2e-web/preview.spec.ts`
  - Verifies real VexFlow renders initial + changed tempo markings.
- `packages/e2e-web/blog.spec.ts`
  - Verifies the published seeded chart navigates from blog to `/preview/[id]`.

---

### Task 1: Normalize effective tempo once in `ChartTiming`

**Files:**
- Modify: `packages/common/src/lib/notation/model.ts:1-35`
- Modify: `packages/common/src/lib/notation/timing.ts:1-155`
- Test: `packages/common/src/lib/notation/timing.test.ts:1-170`

**Interfaces:**
- Consumes: existing `TimingInput { bpm, bpmValueMap, bpmChanges, measureLengths, measureCount }`.
- Produces: `NotationTempoEvent`, `normalizeTempoEvents(input): NotationTempoEvent[]`, and `ChartTiming.tempoEvents: NotationTempoEvent[]`.
- Later tasks rely on `ChartTiming.tempoEvents` being the exact sequence used by `positionToTime()` / `timeToPosition()`.

- [ ] **Step 1: Add failing normalization tests**

Extend `timing.test.ts` imports:

```ts
import { buildChartTiming, normalizeTempoEvents } from './timing';
```

Add focused tests:

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

it('ignores unresolved and invalid bpm changes', () => {
	const bpmChanges = [
		new LaneMeasureNote(0, '08', [
			{ noteID: 'MISSING', position: 0.25 },
			{ noteID: 'ZERO', position: 0.5 },
			{ noteID: 'NEG', position: 0.75 }
		])
	];

	const events = normalizeTempoEvents({
		bpm: 120,
		bpmValueMap: { ZERO: 0, NEG: -10 },
		bpmChanges,
		measureLengths: [1],
		measureCount: 1
	});

	expect(events).toEqual([{ measure: 0, fraction: 0, bpm: 120 }]);
});
```

Also extend the existing mid-measure round-trip test with:

```ts
expect(t.tempoEvents).toEqual([
	{ measure: 0, fraction: 0, bpm: 120 },
	{ measure: 0, fraction: 0.5, bpm: 240 }
]);
```

- [ ] **Step 2: Run the timing tests and verify they fail**

Run:

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts
```

Expected: FAIL because `normalizeTempoEvents` and `ChartTiming.tempoEvents` do not exist.

- [ ] **Step 3: Add the narrow notation tempo type**

In `model.ts`, add:

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

In `timing.ts`, import the type and add the pure helper:

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

	return events;
};
```

After exact-position replacement, do a final adjacent-deduplication pass so `120 -> 180 -> 120` remains three events but an exact-position replacement that returns to the previous BPM does not leave a redundant event:

```ts
return events.filter((event, index) => index === 0 || event.bpm !== events[index - 1].bpm);
```

- [ ] **Step 5: Make forward and inverse timing consume the normalized sequence**

Change the internal helpers so they receive `tempoEvents` rather than filtering raw `input.bpmChanges`.

Use this shape for `secondsIntoMeasure()`:

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

Apply the same source to `fractionAtSeconds()` by building its bounds from:

```ts
const bounds = tempoEvents.filter(
	(event) => event.measure === measure && event.fraction >= 0 && event.fraction < 1
);
```

Then in `buildChartTiming()`:

```ts
const tempoEvents = normalizeTempoEvents(input);
```

Pass `tempoEvents` into both helpers, and return it:

```ts
return {
	tempoEvents,
	measureStartSeconds,
	totalDuration,
	positionToTime,
	timeToPosition
};
```

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

- [ ] **Step 6: Run the timing tests and verify they pass**

Run:

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts
```

Expected: PASS, including the existing mid-measure and downbeat round-trip tests.

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
- Modify: `packages/common/src/lib/notation/quantize.ts:205-300`
- Test: `packages/common/src/lib/notation/quantize.test.ts:680-end`

**Interfaces:**
- Consumes: `ChartTiming.tempoEvents` from Task 1.
- Produces: `buildNotationChart(dtx).chart.tempoEvents`, with the same array reference/content as `timing.tempoEvents`.
- Preserves existing channel `03` conversion to synthetic `03:${noteID}` map keys.

- [ ] **Step 1: Add failing DTX integration tests**

Extend the existing channel `08` and `03` tests:

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
```

Add a mid-measure DTX test:

```ts
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

Keep the existing legacy-channel conversion block intact. Only change the returned chart after `buildChartTiming()`:

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

- [ ] **Step 4: Run common notation tests**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts src/lib/notation/quantize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Build the shared package**

```bash
bun run --filter=@dtx/common build
```

Expected: PASS. This catches downstream type/export issues before the Svelte task.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/common/src/lib/notation/quantize.ts \
  packages/common/src/lib/notation/quantize.test.ts
git commit -m "feat(common): expose notation tempo events"
```

---

### Task 3: Render measure boundaries and BPM markings in VexFlow

**Files:**
- Modify: `packages/dtx-web/src/lib/components/preview/NotationView.svelte:1-260`
- Test: `packages/dtx-web/src/lib/components/preview/NotationView.test.ts:1-end`
- Test: `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts:1-end`

**Interfaces:**
- Consumes: `chart.tempoEvents: NotationTempoEvent[]` from Task 2.
- Produces: one end bar per measure, VexFlow stave-tempo marks for measure-start events, and non-spacing mid-measure tempo annotations.
- Uses VexFlow 4.2.5 exports `BarlineType` and `StaveTempo`.

- [ ] **Step 1: Extend the VexFlow happy-path mock and add failing renderer tests**

In `NotationView.test.ts`, add hoisted captures:

```ts
const begBarTypes = vi.hoisted(() => [] as number[]);
const endBarTypes = vi.hoisted(() => [] as number[]);
const staveTempoCalls = vi.hoisted(() => [] as Array<{ bpm?: number; duration?: string }>);
const freeTempoCalls = vi.hoisted(
	() => [] as Array<{ x: number; bpm?: number; duration?: string }>
);
```

Extend the mocked `Stave`:

```ts
setBegBarType(type: number) {
	begBarTypes.push(type);
	return this;
}
setEndBarType(type: number) {
	endBarTypes.push(type);
	return this;
}
setTempo(tempo: { bpm?: number; duration?: string }) {
	staveTempoCalls.push(tempo);
	return this;
}
```

Add these exports to the VexFlow mock:

```ts
BarlineType: { NONE: 0, SINGLE: 1 },
StaveTempo: class {
	constructor(tempo: { bpm?: number; duration?: string }, x: number) {
		freeTempoCalls.push({ x, ...tempo });
	}
	draw() {
		return this;
	}
}
```

Update all `NotationChart` fixtures in `NotationView.test.ts` to include `tempoEvents: []` unless a test needs tempo data.

Add renderer tests:

```ts
it('renders a single end bar per measure and suppresses duplicate begin bars', async () => {
	const twoMeasureChart: NotationChart = {
		measures: [chart.measures[0], { ...chart.measures[0], index: 1 }],
		tempoEvents: []
	};

	render(NotationView, { props: { chart: twoMeasureChart } });
	await tick();

	expect(endBarTypes).toEqual([1, 1]);
	expect(begBarTypes[0]).toBe(1);
	expect(begBarTypes[1]).toBe(0);
});

it('renders measure-start tempo through Stave.setTempo', async () => {
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0, bpm: 120 }]
	};

	render(NotationView, { props: { chart: tempoChart } });
	await tick();

	expect(staveTempoCalls).toContainEqual({ bpm: 120, duration: 'q' });
});

it('renders a mid-measure tempo at the proportional stave x without adding voice notes', async () => {
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0.5, bpm: 180 }]
	};

	render(NotationView, { props: { chart: tempoChart } });
	await tick();

	// Mocked note range is 30..200; halfway = 115.
	expect(freeTempoCalls).toContainEqual({ x: 115, bpm: 180, duration: 'q' });
	expect(staveNoteArgs).toHaveLength(chart.measures[0].entries.length);
});
```

Clear the new capture arrays in `beforeEach()`.

- [ ] **Step 2: Update the error-path VexFlow mock before running production changes**

In `NotationView.errors.test.ts`, add no-op methods to the mocked `Stave`:

```ts
setBegBarType() {
	return this;
}
setEndBarType() {
	return this;
}
setTempo() {
	return this;
}
```

Add:

```ts
BarlineType: { NONE: 0, SINGLE: 1 },
StaveTempo: class {
	constructor(_tempo: unknown, _x: number) {}
	draw() {
		return this;
	}
}
```

and add `tempoEvents: []` to its chart fixture.

- [ ] **Step 3: Run renderer tests and verify the new happy-path assertions fail**

```bash
bun run --filter=dtx-web test -- src/lib/components/preview/NotationView.test.ts src/lib/components/preview/NotationView.errors.test.ts
```

Expected: new barline/tempo tests FAIL because `NotationView.svelte` does not call these APIs yet; existing error-path tests remain structurally runnable.

- [ ] **Step 4: Import the VexFlow APIs and create a per-measure tempo lookup**

Change the import:

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

Inside `renderChart()`, before the `layout.forEach`, group tempo events once:

```ts
const tempoEventsByMeasure = new Map<number, typeof chart.tempoEvents>();
for (const event of chart.tempoEvents) {
	const events = tempoEventsByMeasure.get(event.measure);
	if (events) events.push(event);
	else tempoEventsByMeasure.set(event.measure, [event]);
}
```

- [ ] **Step 5: Make measure boundaries explicit without double bars**

Immediately after creating each `Stave`:

```ts
const stave = new Stave(x, y, width);
stave.setBegBarType(firstInRow ? BarlineType.SINGLE : BarlineType.NONE);
stave.setEndBarType(BarlineType.SINGLE);
```

Keep the existing percussion-clef and time-signature logic unchanged.

- [ ] **Step 6: Render tempo annotations without touching the rhythmic voice**

Before `stave.setContext(context).draw()`, attach a measure-start tempo event:

```ts
const tempoEvents = tempoEventsByMeasure.get(measure.index) ?? [];
const startTempo = tempoEvents.find((event) => event.fraction === 0);
if (startTempo) {
	stave.setTempo({ bpm: startTempo.bpm, duration: 'q' }, 0);
}
```

After `voice.draw()`, beams, and tuplets have been drawn, render mid-measure events from the laid-out stave coordinates:

```ts
for (const event of tempoEvents) {
	if (event.fraction <= 0) continue;
	try {
		const xPos =
			stave.getNoteStartX() +
			event.fraction * (stave.getNoteEndX() - stave.getNoteStartX());
		new StaveTempo({ bpm: event.bpm, duration: 'q' }, xPos, 0).draw(stave, 0);
	} catch (error) {
		console.warn(`Failed to render tempo in measure ${measure.index}`, error);
	}
}
```

Do not add tempo objects to `notes`, `Voice`, `Beam.generateBeams()`, tuplets, or `noteOnsets`.

Increase system headroom using the existing local constants, for example:

```ts
const SYSTEM_HEIGHT = 160;
const TOP = 30;
```

Keep the change fixed and local; do not introduce dynamic text measurement.

- [ ] **Step 7: Add one non-fatal tempo-draw error test**

In `NotationView.errors.test.ts`, make the mocked `StaveTempo.draw()` optionally throw and add:

```ts
it('skips a failing mid-measure tempo annotation without dropping the measure', async () => {
	const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0.5, bpm: 180 }]
	};
	throwTempoDraw = true;

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

- [ ] **Step 8: Run renderer tests and Svelte type checking**

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

### Task 4: Route blog cards to Preview while keeping owner cards editor-first

**Files:**
- Modify: `packages/dtx-web/src/lib/components/ChartListItem.svelte:1-230`
- Test: `packages/dtx-web/src/lib/components/ChartListItem.test.ts:1-end`

**Interfaces:**
- Consumes: existing props `item`, `isBlog`, `enableDownload`.
- Produces: contextual title href and explicit Preview actions.
- `previewable` means `item.id !== undefined && item.is_published === true && item.has_uploaded_files === true`.

- [ ] **Step 1: Add failing card navigation tests**

Add to the existing rendering tests:

```ts
it('routes a previewable blog card title to the public preview', () => {
	render(ChartListItem, {
		props: { ...renderProps, isBlog: true, item: mockItem }
	});

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

it('does not render a preview link for a blog chart without uploaded files', () => {
	render(ChartListItem, {
		props: {
			...renderProps,
			isBlog: true,
			item: { ...mockItem, has_uploaded_files: false }
		}
	});

	expect(screen.queryByRole('link', { name: 'Test Song 1' })).not.toBeInTheDocument();
});
```

Add action assertions using the existing `preview.open` i18n key returned by the mock:

```ts
it('shows an explicit Preview action on previewable blog cards', () => {
	render(ChartListItem, { props: { ...renderProps, isBlog: true } });
	const previewLinks = screen.getAllByRole('link', { name: 'preview.open' });
	expect(previewLinks.some((link) => link.getAttribute('href') === '/preview/1')).toBe(true);
});
```

For owner mode, open the action popover using the existing `Actions` button and assert the new secondary Preview link and renamed details action.

- [ ] **Step 2: Run the card test and verify the blog-route assertions fail**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartListItem.test.ts
```

Expected: FAIL because the title still targets `/editor/1` in blog mode and there is no Preview CTA/menu action.

- [ ] **Step 3: Derive contextual card destinations**

In `ChartListItem.svelte`, replace `canOpenEditor` with explicit derived state:

```ts
const hasUploadedChart = $derived(item.id !== undefined && item.has_uploaded_files === true);
const previewable = $derived(
	item.id !== undefined && item.is_published === true && item.has_uploaded_files === true
);
const titleHref = $derived(
	item.id === undefined
		? null
		: isBlog
			? previewable
				? `/preview/${item.id}`
				: null
			: hasUploadedChart
				? `/editor/${item.id}`
				: null
);
```

Render the title using `titleHref`:

```svelte
{#if titleHref}
	<a href={titleHref} class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400">
		{item.title}
	</a>
{:else}
	{item.title}
{/if}
```

Keep `handleOpenInEditor()` guarded by `hasUploadedChart`.

- [ ] **Step 4: Add owner Preview and clarify Edit details**

Inside the non-blog popover, keep **Open in Editor** first. For previewable charts add:

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

Change the existing `/app/chart/${item.id}` label from:

```text
Edit
```

to:

```text
Edit details
```

- [ ] **Step 5: Add the explicit blog Preview CTA next to download**

At the start of the existing blog footer action area:

```svelte
{#if isBlog && item.id !== undefined}
	<div class="mt-4 flex flex-wrap items-center gap-2">
		{#if previewable}
			<a
				href={`/preview/${item.id}`}
				class="music-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
			>
				{$_('preview.open')}
			</a>
		{/if}
		<!-- keep the existing DownloadDropdown / external-download branch here -->
	</div>
{/if}
```

Move the current download branch into the same flex container; do not alter its eligibility rules.

- [ ] **Step 6: Run card tests**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartListItem.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add packages/dtx-web/src/lib/components/ChartListItem.svelte \
  packages/dtx-web/src/lib/components/ChartListItem.test.ts
git commit -m "feat(web): route chart cards by context"
```

---

### Task 5: Apply the same contextual navigation to table view

**Files:**
- Modify: `packages/dtx-web/src/lib/components/ChartList.svelte:250-390`
- Modify: `packages/dtx-web/src/lib/components/ChartListTableItem.svelte:1-130`
- Test: `packages/dtx-web/src/lib/components/ChartList.test.ts:1-end`
- Create: `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`

**Interfaces:**
- Consumes: the same `isBlog`, `is_published`, and `has_uploaded_files` context as Task 4.
- Produces: table title `/preview/[id]` in blog mode, `/editor/[id]` in owner mode, plus compact Preview action for public rows and secondary Preview/Edit-details actions for owners.

- [ ] **Step 1: Add failing table-title tests to `ChartList.test.ts`**

Add a helper that renders one loaded item and switches to table mode:

```ts
const renderSingleChartInTableMode = async (isBlog: boolean) => {
	mockApi.listSimfiles.mockResolvedValue({ data: [mockListedChart], count: 1 });
	render(ChartList, { props: { isBlog } });
	await screen.findByText(mockListedChart.title);
	await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
};
```

Add:

```ts
it('routes a previewable blog table title to /preview/:id', async () => {
	await renderSingleChartInTableMode(true);
	const link = screen.getByRole('link', { name: /Test Song 1/ });
	expect(link).toHaveAttribute('href', '/preview/1');
});

it('keeps an uploaded owner table title pointed at /editor/:id', async () => {
	await renderSingleChartInTableMode(false);
	const link = screen.getByRole('link', { name: /Test Song 1/ });
	expect(link).toHaveAttribute('href', '/editor/1');
});
```

- [ ] **Step 2: Create focused failing tests for table actions**

Create `ChartListTableItem.test.ts` with the existing project mocks (`svelte-i18n`, Skeleton `Popover`, UI `Modal`/`Button`, `$app/navigation`, toaster) and a previewable item:

```ts
const item = {
	id: 1,
	is_published: true,
	download_url: 'https://example.com/chart.zip',
	has_uploaded_files: true
};
```

Cover:

```ts
it('shows a compact Preview link in blog mode', () => {
	render(ChartListTableItem, {
		props: {
			item,
			isBlog: true,
			enableDownload: false,
			togglePublishChart: vi.fn(),
			onFileDelete: vi.fn()
		}
	});

	expect(screen.getByRole('link', { name: 'preview.open' })).toHaveAttribute(
		'href',
		'/preview/1'
	);
});

it('shows Preview and Edit details in the owner action menu', async () => {
	render(ChartListTableItem, {
		props: {
			item,
			isBlog: false,
			togglePublishChart: vi.fn(),
			onFileDelete: vi.fn()
		}
	});

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

Also assert no Preview link when `has_uploaded_files: false`.

- [ ] **Step 3: Run table tests and verify they fail**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartList.test.ts src/lib/components/ChartListTableItem.test.ts
```

Expected: FAIL on blog title routing and missing table Preview actions.

- [ ] **Step 4: Make the table title contextual in `ChartList.svelte`**

Inside the table-row title block, replace the hard-coded editor href with:

```svelte
{#if item.has_uploaded_files === true}
	<a
		href={isBlog && item.is_published ? `/preview/${item.id}` : `/editor/${item.id}`}
		class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
	>
		{item.display_id}. {item.title}
	</a>
{:else}
	{item.display_id}. {item.title}
{/if}
```

Because blog data is published-scoped, the `is_published` check is defensive; keep it anyway so the UI rule remains explicit.

- [ ] **Step 5: Add compact and owner Preview actions to `ChartListTableItem.svelte`**

Add:

```ts
const previewable = $derived(item.is_published === true && item.has_uploaded_files === true);
```

In owner mode, after **Open in Editor**, add a Preview menu link when `previewable` and rename the existing `Edit` link to `Edit details`.

For blog mode, make Preview independent of download availability:

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
				<!-- reuse an existing suitable Lucide external/open icon -->
				<ExternalLink size="16" />
			</a>
		{/if}
		<!-- keep the existing download / external-link rendering next -->
	</div>
{/if}
```

Restructure the current `{:else if enableDownload}` / external-link chain under this single blog `{:else}` so Preview and Download can coexist. Do not change download behavior.

- [ ] **Step 6: Run navigation unit tests and web checks**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartListItem.test.ts src/lib/components/ChartList.test.ts src/lib/components/ChartListTableItem.test.ts
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

### Task 6: Verify real VexFlow tempo rendering and the public Blog → Preview journey

**Files:**
- Modify: `packages/e2e-web/fixtures/test-sample.dtx:1-10`
- Modify: `packages/e2e-web/preview.spec.ts:1-end`
- Modify: `packages/e2e-web/blog.spec.ts:1-end`

**Interfaces:**
- Consumes: existing seeded published chart `CHART_B_ID = 1002` / `CHART_B_TITLE = 'E2E Download Chart'` and the existing preview R2 interception.
- Produces: one browser-level assertion for real tempo rendering and one browser-level public navigation assertion.

- [ ] **Step 1: Add a real channel `08` change to the DTX fixture**

Keep the existing base BPM and add a named BPM plus a measure-start channel `08` event:

```dtx
#TITLE:Test Sample Song
#ARTIST:Test Artist
#BPM:120
#BPMAA:180
#DLEVEL:5
#COMMENT:Test DTX file for e2e testing

#00208: AA
001: 01020300
002: 00000400
003: 01000200
004: 00030000
```

If the parser requires compact channel data rather than whitespace for this fixture, use the same form already covered in `quantize.test.ts` (`#00208: AA`); do not invent a separate fixture parser path.

- [ ] **Step 2: Add the failing real-VexFlow tempo assertion**

In `preview.spec.ts`, add:

```ts
test('renders the starting tempo and a channel-08 tempo change', async ({ page }) => {
	const container = page.getByTestId('notation-container');
	await expect(container).toBeVisible({ timeout: 15000 });

	await expect(container.getByText(/= 120/)).toBeVisible();
	await expect(container.getByText(/= 180/)).toBeVisible();
});
```

This deliberately checks browser-visible VexFlow output, while edge-case tempo semantics remain unit-tested.

- [ ] **Step 3: Add the failing Blog → Preview navigation assertion**

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

- [ ] **Step 4: Run focused E2E tests**

Run from the repository root; Playwright owns its own web/API/Supabase stack:

```bash
bun run --filter=dtx-e2e-web e2e -- preview.spec.ts blog.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run the final regression suite for touched packages**

```bash
bun run --filter=@dtx/common test
bun run --filter=@dtx/common build
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-e2e-web check
```

Expected: all commands PASS.

- [ ] **Step 6: Inspect the final diff for scope creep**

```bash
git diff main...HEAD -- \
  packages/common/src/lib/notation \
  packages/dtx-web/src/lib/components \
  packages/e2e-web
```

Confirm there are no changes to GraphQL/API, auth, desktop, editor navigation, Phaser preview, or unrelated components.

- [ ] **Step 7: Commit Task 6**

```bash
git add packages/e2e-web/fixtures/test-sample.dtx \
  packages/e2e-web/preview.spec.ts \
  packages/e2e-web/blog.spec.ts
git commit -m "test(e2e): cover preview tempo and blog navigation"
```

---

## Final Acceptance Checklist

- [ ] `ChartTiming.tempoEvents` exists and is the source used by both forward and inverse timing.
- [ ] `NotationChart.tempoEvents === timing.tempoEvents` for `buildNotationChart()` output.
- [ ] Base BPM, channel `08`, and channel `03` changes normalize correctly.
- [ ] Exact channel `08`/`03` ties use the documented input-order rule.
- [ ] Invalid/unresolved tempo values never create bogus notation marks.
- [ ] Every measure has one explicit end bar and adjacent measures do not double the boundary.
- [ ] Start/downbeat BPM changes render with VexFlow tempo notation.
- [ ] Mid-measure BPM changes render at proportional stave x without entering the rhythmic voice.
- [ ] Tempo annotation failures remain non-fatal.
- [ ] Blog card title and Preview CTA target `/preview/[id]` only when previewable.
- [ ] Blog table title/action target `/preview/[id]` only when previewable.
- [ ] Owner card/table titles remain `/editor/[id]` for uploaded charts.
- [ ] Owner secondary Preview appears only for published + uploaded charts.
- [ ] Owner metadata action is labelled `Edit details` and targets `/app/chart/[id]`.
- [ ] Public preview and editor-shell navigation remain unchanged.
- [ ] No API/GraphQL/database/auth/desktop/Phaser changes are present.
- [ ] Common unit tests, web unit tests/check, and focused E2E tests pass.
