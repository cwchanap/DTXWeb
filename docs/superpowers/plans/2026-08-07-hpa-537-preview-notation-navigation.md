# HPA-537 Preview Notation and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render measure boundaries and effective BPM changes in the public notation preview, while routing public blog users to Preview and owner chart-management users to Editor.

**Architecture:** Normalize DTX tempo changes once in `@dtx/common`, expose that sequence as `ChartTiming.tempoEvents`, and copy the exact same array into `NotationChart` for VexFlow rendering. Render all tempo marks through VexFlow's `StaveTempo` after the stave itself is drawn so annotation failures stay isolated from notation layout. Keep navigation contextual inside the existing card/table components: blog mode uses `/preview/[id]`; owner mode keeps `/editor/[id]`, with Preview as a secondary action.

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
- All BPM markings use VexFlow `StaveTempo`; they must not participate in the rhythmic `Voice`, alter note spacing, or affect cursor geometry.
- Public blog navigation targets `/preview/[id]`; owner chart-list navigation targets `/editor/[id]`.
- A blog row that is not previewable stays non-clickable; it must never fall back to Editor.
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
- Later tasks rely on `ChartTiming.tempoEvents` being the exact sequence used by `positionToTime()` and `timeToPosition()`.

- [ ] **Step 1: Add failing normalization tests**

Extend `timing.test.ts` imports:

```ts
import { buildChartTiming, normalizeTempoEvents } from './timing';
```

Add these tests:

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

	return events.filter((event, index) => index === 0 || event.bpm !== events[index - 1].bpm);
};
```

- [ ] **Step 5: Make forward and inverse timing consume the normalized sequence**

Refactor the internal helpers so they no longer filter raw `input.bpmChanges`.

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

Build `fractionAtSeconds()` bounds from the same sequence:

```ts
const bounds = tempoEvents.filter(
	(event) => event.measure === measure && event.fraction >= 0 && event.fraction < 1
);
```

In `buildChartTiming()`:

```ts
const tempoEvents = normalizeTempoEvents(input);
```

Pass `tempoEvents` into both helpers and return it:

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

Expected: PASS, including existing downbeat and mid-measure round-trip coverage.

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
- Produces: `buildNotationChart(dtx).chart.tempoEvents`, using the same array reference as `timing.tempoEvents`.
- Preserves the existing channel `03` conversion to synthetic `03:${noteID}` map keys.

- [ ] **Step 1: Add failing DTX integration tests**

Add:

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

- [ ] **Step 4: Run common notation tests**

```bash
bun run --filter=@dtx/common test -- src/lib/notation/timing.test.ts src/lib/notation/quantize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Build the shared package**

```bash
bun run --filter=@dtx/common build
```

Expected: PASS.

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
```

Add to the VexFlow mock:

```ts
BarlineType: { NONE: 0, SINGLE: 1 },
StaveTempo: class {
	constructor(tempo: { bpm?: number; duration?: string }, x: number) {
		tempoCalls.push({ x, ...tempo });
	}
	draw() {
		return this;
	}
}
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

	expect(endBarTypes).toEqual([1, 1]);
	expect(begBarTypes[0]).toBe(1);
	expect(begBarTypes[1]).toBe(0);
});

it('renders a measure-start tempo with VexFlow StaveTempo', async () => {
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0, bpm: 120 }]
	};

	render(NotationView, { props: { chart: tempoChart } });
	await tick();

	// Mocked note start x is 30.
	expect(tempoCalls).toContainEqual({ x: 30, bpm: 120, duration: 'q' });
});

it('renders a mid-measure tempo at proportional stave x without adding voice notes', async () => {
	const tempoChart: NotationChart = {
		...chart,
		tempoEvents: [{ measure: 0, fraction: 0.5, bpm: 180 }]
	};

	render(NotationView, { props: { chart: tempoChart } });
	await tick();

	// Mocked note range is 30..200; halfway = 115.
	expect(tempoCalls).toContainEqual({ x: 115, bpm: 180, duration: 'q' });
	expect(staveNoteArgs).toHaveLength(chart.measures[0].entries.length);
});
```

Clear `begBarTypes`, `endBarTypes`, and `tempoCalls` in `beforeEach()`.

- [ ] **Step 2: Update the error-path VexFlow mock so new calls are supported**

In `NotationView.errors.test.ts`, add:

```ts
let throwTempoDraw = false;
```

Extend the mocked `Stave`:

```ts
setBegBarType() {
	return this;
}
setEndBarType() {
	return this;
}
```

Add:

```ts
BarlineType: { NONE: 0, SINGLE: 1 },
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

Expected: new barline/tempo tests FAIL because the component does not call these APIs yet.

- [ ] **Step 4: Import VexFlow barline and tempo APIs**

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

- [ ] **Step 6: Make measure boundaries explicit without doubles**

Immediately after constructing a stave:

```ts
const firstInRow = x === LEFT;
const stave = new Stave(x, y, width);
stave.setBegBarType(firstInRow ? BarlineType.SINGLE : BarlineType.NONE);
stave.setEndBarType(BarlineType.SINGLE);
```

Keep the existing percussion-clef and time-signature behavior unchanged.

- [ ] **Step 7: Draw all BPM markings after base notation drawing**

After `voice.draw()`, beams, and tuplets are drawn, add:

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

This uses standard VexFlow tempo glyphs for both downbeat and mid-measure events but keeps them outside the `Voice`, so a tempo failure cannot invalidate `stave.draw()` or rhythmic layout.

Increase fixed vertical headroom only:

```ts
const SYSTEM_HEIGHT = 160;
const TOP = 30;
```

Do not add dynamic annotation measurement.

- [ ] **Step 8: Add a non-fatal tempo-draw error test**

In `NotationView.errors.test.ts` add:

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

- [ ] **Step 9: Run renderer tests and Svelte checking**

```bash
bun run --filter=dtx-web test -- src/lib/components/preview/NotationView.test.ts src/lib/components/preview/NotationView.errors.test.ts
bun run --filter=dtx-web check
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

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

Add:

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

it('does not fall back to editor for an unpublished blog card', () => {
	render(ChartListItem, {
		props: {
			...renderProps,
			isBlog: true,
			item: { ...mockItem, is_published: false }
		}
	});

	expect(screen.queryByRole('link', { name: 'Test Song 1' })).not.toBeInTheDocument();
});

it('shows an explicit Preview action on previewable blog cards', () => {
	render(ChartListItem, { props: { ...renderProps, isBlog: true } });
	const previewLinks = screen.getAllByRole('link', { name: 'preview.open' });
	expect(previewLinks.some((link) => link.getAttribute('href') === '/preview/1')).toBe(true);
});
```

Add an owner-action test using the existing Popover stub:

```ts
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

- [ ] **Step 2: Run the card test and verify failures**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartListItem.test.ts
```

Expected: FAIL because blog titles still target Editor and Preview actions do not exist.

- [ ] **Step 3: Derive contextual card destinations**

Replace `canOpenEditor` with:

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

Render:

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

Keep `handleOpenInEditor()` available only for `hasUploadedChart`.

- [ ] **Step 4: Add owner Preview and rename Edit details**

Inside the non-blog popover, after **Open in Editor**:

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

Change the existing `/app/chart/${item.id}` text from `Edit` to `Edit details`.

- [ ] **Step 5: Add the explicit blog Preview CTA next to download**

Wrap public footer actions in one flex row:

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

		{#if enableDownload}
			<DownloadDropdown
				simfileId={item.id}
				externalUrl={item.download_url ?? null}
				hasUploadedFiles={item.has_uploaded_files}
			/>
		{:else if item.download_url}
			<!-- retain the existing external download anchor unchanged -->
		{:else}
			<div class="text-sm text-slate-500 italic">Download not available</div>
		{/if}
	</div>
{/if}
```

The external-download anchor body remains byte-for-byte equivalent to the current implementation; only its parent layout changes.

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

### Task 5: Apply contextual navigation to table view

**Files:**
- Modify: `packages/dtx-web/src/lib/components/ChartList.svelte:250-390`
- Modify: `packages/dtx-web/src/lib/components/ChartListTableItem.svelte:1-130`
- Test: `packages/dtx-web/src/lib/components/ChartList.test.ts:1-end`
- Create: `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`

**Interfaces:**
- Consumes: the same `isBlog`, `is_published`, and `has_uploaded_files` context as Task 4.
- Produces: blog table title `/preview/[id]`, owner table title `/editor/[id]`, compact public Preview action, and owner Preview/Edit-details actions.

- [ ] **Step 1: Add failing table-title tests to `ChartList.test.ts`**

Add:

```ts
const renderSingleChartInTableMode = async (isBlog: boolean) => {
	mockApi.listSimfiles.mockResolvedValue({ data: [mockListedChart], count: 1 });
	render(ChartList, { props: { isBlog } });
	await screen.findByText(mockListedChart.title);
	await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
};

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

Add a defensive non-previewable blog test by overriding the item:

```ts
it('keeps an unpublished blog table title non-clickable', async () => {
	mockApi.listSimfiles.mockResolvedValue({
		data: [{ ...mockListedChart, is_published: false }],
		count: 1
	});
	render(ChartList, { props: { isBlog: true } });
	await screen.findByText(mockListedChart.title);
	await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));

	expect(screen.queryByRole('link', { name: /Test Song 1/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Create a focused failing `ChartListTableItem.test.ts`**

Create the file with these mocks and tests:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('svelte-i18n');
vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: PopoverStub } = await import('../../tests/stubs/PopoverStub.svelte');
	return { Popover: PopoverStub };
});
vi.mock('@dtx/ui-components/components', async () => {
	const { default: ModalStub } = await import('../../tests/stubs/ModalStub.svelte');
	return { Modal: ModalStub };
});
vi.mock('@dtx/ui-components', async () => {
	const { default: ButtonStub } = await import('../../tests/stubs/ButtonStub.svelte');
	return { Button: ButtonStub };
});
vi.mock('@lucide/svelte/icons');
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/toaster', () => ({ default: { error: vi.fn() } }));

import ChartListTableItem from './ChartListTableItem.svelte';

const item = {
	id: 1,
	is_published: true,
	download_url: 'https://example.com/chart.zip',
	has_uploaded_files: true
};

const baseProps = {
	item,
	togglePublishChart: vi.fn().mockResolvedValue(undefined),
	onFileDelete: vi.fn()
};

describe('ChartListTableItem', () => {
	it('shows a compact Preview link in blog mode', () => {
		render(ChartListTableItem, {
			props: { ...baseProps, isBlog: true, enableDownload: false }
		});

		expect(screen.getByRole('link', { name: 'preview.open' })).toHaveAttribute(
			'href',
			'/preview/1'
		);
	});

	it('hides Preview in blog mode when uploaded files are unavailable', () => {
		render(ChartListTableItem, {
			props: {
				...baseProps,
				isBlog: true,
				enableDownload: false,
				item: { ...item, has_uploaded_files: false }
			}
		});

		expect(screen.queryByRole('link', { name: 'preview.open' })).not.toBeInTheDocument();
	});

	it('shows Preview and Edit details in the owner action menu', async () => {
		render(ChartListTableItem, {
			props: { ...baseProps, isBlog: false }
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
});
```

- [ ] **Step 3: Run table tests and verify failures**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartList.test.ts src/lib/components/ChartListTableItem.test.ts
```

Expected: FAIL on blog title routing and missing Preview actions.

- [ ] **Step 4: Make the table title contextual in `ChartList.svelte`**

Replace the current title link branch with:

```svelte
{#if item.has_uploaded_files === true && (!isBlog || item.is_published === true)}
	<a
		href={isBlog ? `/preview/${item.id}` : `/editor/${item.id}`}
		class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
	>
		{item.display_id}. {item.title}
	</a>
{:else}
	{item.display_id}. {item.title}
{/if}
```

This intentionally leaves a defensive unpublished blog row non-clickable instead of falling back to Editor.

- [ ] **Step 5: Add Preview/Edit-details actions to `ChartListTableItem.svelte`**

Import i18n:

```ts
import { _ } from 'svelte-i18n';
```

Add:

```ts
const previewable = $derived(item.is_published === true && item.has_uploaded_files === true);
```

In owner mode, after **Open in Editor**:

```svelte
{#if previewable}
	<a href={`/preview/${item.id}`} role="menuitem" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
		{$_('preview.open')}
	</a>
{/if}
```

Rename the existing `/app/chart/${item.id}` link to `Edit details`.

Restructure the blog branch into one action row:

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
				<ExternalLink size="16" />
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
			<!-- retain the current external-download anchor unchanged -->
		{:else}
			<!-- retain the current disabled external-link span unchanged -->
		{/if}
	</div>
{/if}
```

Only the parent conditional/layout changes; download eligibility and URLs stay unchanged.

- [ ] **Step 6: Run navigation unit tests and web checking**

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

### Task 6: Verify real VexFlow tempo rendering and Blog → Preview navigation

**Files:**
- Modify: `packages/e2e-web/fixtures/test-sample.dtx:1-10`
- Modify: `packages/e2e-web/preview.spec.ts:1-end`
- Modify: `packages/e2e-web/blog.spec.ts:1-end`

**Interfaces:**
- Consumes: existing seeded published chart `CHART_B_ID = 1002`, `CHART_B_TITLE = 'E2E Download Chart'`, and the existing preview R2 interception.
- Produces: one browser-level real-rendering check and one public navigation journey.

- [ ] **Step 1: Add a real channel `08` change to the DTX fixture**

Change the fixture to:

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

The `#00208: AA` form matches the syntax already exercised by `buildNotationChart()` unit tests.

- [ ] **Step 2: Add the real-VexFlow tempo assertion**

In `preview.spec.ts` add:

```ts
test('renders the starting tempo and a channel-08 tempo change', async ({ page }) => {
	const container = page.getByTestId('notation-container');
	await expect(container).toBeVisible({ timeout: 15000 });

	await expect(container.getByText(/= 120/)).toBeVisible();
	await expect(container.getByText(/= 180/)).toBeVisible();
});
```

This checks only browser-visible VexFlow output; edge-case tempo semantics stay in unit tests.

- [ ] **Step 3: Add Blog → Preview navigation coverage**

Update `blog.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { PAGES } from './constants';
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

Run from repository root; Playwright manages its own web/API/Supabase stack:

```bash
bun run --filter=dtx-e2e-web e2e -- preview.spec.ts blog.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run final regression checks for touched packages**

```bash
bun run --filter=@dtx/common test
bun run --filter=@dtx/common build
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-e2e-web check
```

Expected: all commands PASS.

- [ ] **Step 6: Inspect the final implementation diff for scope creep**

```bash
git diff main...HEAD -- \
  packages/common/src/lib/notation \
  packages/dtx-web/src/lib/components \
  packages/e2e-web
```

Confirm there are no implementation changes under GraphQL/API, auth, desktop, editor navigation, Phaser preview, or unrelated components.

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
- [ ] Downbeat and mid-measure BPM changes render through VexFlow `StaveTempo` outside the rhythmic voice.
- [ ] Tempo annotation failures remain non-fatal.
- [ ] Blog card title and Preview CTA target `/preview/[id]` only when previewable.
- [ ] Blog table title/action target `/preview/[id]` only when previewable.
- [ ] Non-previewable blog cards/rows never fall back to `/editor/[id]`.
- [ ] Owner card/table titles remain `/editor/[id]` for uploaded charts.
- [ ] Owner secondary Preview appears only for published + uploaded charts.
- [ ] Owner metadata action is labelled `Edit details` and targets `/app/chart/[id]`.
- [ ] Public preview and editor-shell navigation remain unchanged.
- [ ] No API/GraphQL/database/auth/desktop/Phaser changes are present.
- [ ] Common unit tests, web unit tests/check, and focused E2E tests pass.
