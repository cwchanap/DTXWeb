# Preview Notation Triplet Durations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add triplet duration support to `/preview` notation engraving without changing playback, cursor timing, transport, API, or audio behavior.

**Architecture:** Keep `NotationMeasure.entries` as the flat tickable sequence and add required `NotationMeasure.tuplets` metadata for VexFlow grouping. The common quantizer detects supported triplet groups and emits real triplet-slot ticks; `NotationView` uses each group's base binary duration only when constructing VexFlow `StaveNote`s and `Tuplet`s.

**Tech Stack:** Bun workspaces, TypeScript 5.x, Svelte 5, Vitest, VexFlow 4.2.5.

## Global Constraints

- Do not run development servers or project-wide builds.
- Do not touch playback engine, audio scheduling, transport, cursor timing, seek behavior, GraphQL/API code, or visual redesign.
- `tuplets` is required on every `NotationMeasure`; non-triplet measures return `tuplets: []`.
- Only support triplets with `{ numNotes: 3, notesOccupied: 2 }`; no quintuplets, septuplets, or nested tuplets.
- Use VexFlow 4.2.5 `new Tuplet(notes, { num_notes, notes_occupied })`; create tuplets before `Beam.generateBeams`.
- Use package-scoped verification commands. Because `@dtx/common` changes, run package-scoped common tests/checks, but do not build `@dtx/common` unless explicitly requested.
- Prefix shell commands with `rtk` in this repository.

---

## File Structure

- Modify `packages/common/src/lib/notation/model.ts`
    - Owns pure notation types. Add `NotationTuplet` and required `tuplets` on `NotationMeasure`.
- Modify `packages/common/src/lib/index.ts`
    - Re-export `type NotationTuplet` from the public common barrel.
- Modify `packages/common/src/lib/notation/quantize.ts`
    - Detect triplet groups during the left-to-right measure walk and emit `NotationTuplet[]`.
- Modify `packages/common/src/lib/notation/quantize.test.ts`
    - Add triplet quantizer coverage and update exact expected measures to include `tuplets: []`.
- Modify `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
    - Import `Tuplet`, use tuplet base durations for covered entries, create/draw VexFlow tuplets.
- Modify `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
    - Extend the VexFlow mock with `Tuplet`, add renderer assertions, add `tuplets: []` to typed chart fixtures.
- Modify `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`
    - Extend the VexFlow mock with `Tuplet` and add `tuplets: []` to its typed chart fixture.
- Modify `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`
    - Add `tuplets: []` to the `readyChart()` fixture so mocked chart output follows the common contract.

---

### Task 1: Common Notation Model And Quantizer

**Files:**

- Modify: `packages/common/src/lib/notation/model.ts`
- Modify: `packages/common/src/lib/index.ts`
- Modify: `packages/common/src/lib/notation/quantize.ts`
- Test: `packages/common/src/lib/notation/quantize.test.ts`

**Interfaces:**

- Produces:
    - `NotationTuplet { startIndex: number; count: number; numNotes: 3; notesOccupied: 2; slotTicks: number; baseDurTicks: number }`
    - `NotationMeasure.tuplets: NotationTuplet[]`
    - `quantizeMeasure()` returns `tuplets: []` for every non-triplet measure.
- Consumes:
    - Existing `LaneMeasureNote`, `laneToStaff()`, `TICKS_PER_WHOLE`, and `DURATION_TABLE` behavior.

- [ ] **Step 1: Write failing quantizer tests**

Add these tests inside the existing `describe('quantizeMeasure', () => { ... })` block in `packages/common/src/lib/notation/quantize.test.ts`, near the other duration/remainder tests:

```ts
it('detects an all-note eighth-triplet group', () => {
	const snare = new LaneMeasureNote(0, '12', [
		{ noteID: '01', position: 0 },
		{ noteID: '01', position: 16 / 192 },
		{ noteID: '01', position: 32 / 192 }
	]);
	const measure = quantizeMeasure(0, [snare]);

	expect(measure.entries.slice(0, 3)).toEqual([
		{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5'] },
		{ kind: 'note', startTick: 16, durTicks: 16, keys: ['c/5'] },
		{ kind: 'note', startTick: 32, durTicks: 16, keys: ['c/5'] }
	]);
	expect(measure.tuplets).toEqual([
		{
			startIndex: 0,
			count: 3,
			numNotes: 3,
			notesOccupied: 2,
			slotTicks: 16,
			baseDurTicks: 24
		}
	]);
	expect(measure.entries.reduce((sum, e) => sum + e.durTicks, 0)).toBe(measure.measureTicks);
});

it('emits rests inside detected triplet groups', () => {
	const snare = new LaneMeasureNote(0, '12', [
		{ noteID: '01', position: 0 },
		{ noteID: '01', position: 32 / 192 }
	]);
	const measure = quantizeMeasure(0, [snare]);

	expect(measure.entries.slice(0, 3)).toEqual([
		{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5'] },
		{ kind: 'rest', startTick: 16, durTicks: 16 },
		{ kind: 'note', startTick: 32, durTicks: 16, keys: ['c/5'] }
	]);
	expect(measure.tuplets).toEqual([
		{
			startIndex: 0,
			count: 3,
			numNotes: 3,
			notesOccupied: 2,
			slotTicks: 16,
			baseDurTicks: 24
		}
	]);
});

it('uses an observed group end to emit a trailing triplet rest', () => {
	const snare = new LaneMeasureNote(0, '12', [
		{ noteID: '01', position: 0 },
		{ noteID: '01', position: 16 / 192 },
		{ noteID: '01', position: 48 / 192 }
	]);
	const measure = quantizeMeasure(0, [snare]);

	expect(measure.entries.slice(0, 4)).toEqual([
		{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5'] },
		{ kind: 'note', startTick: 16, durTicks: 16, keys: ['c/5'] },
		{ kind: 'rest', startTick: 32, durTicks: 16 },
		{ kind: 'note', startTick: 48, durTicks: 96, keys: ['c/5'] }
	]);
	expect(measure.tuplets).toEqual([
		{
			startIndex: 0,
			count: 3,
			numNotes: 3,
			notesOccupied: 2,
			slotTicks: 16,
			baseDurTicks: 24
		}
	]);
});

it('detects a triplet group after a binary quarter note', () => {
	const snare = new LaneMeasureNote(0, '12', [
		{ noteID: '01', position: 0 },
		{ noteID: '01', position: 48 / 192 },
		{ noteID: '01', position: 64 / 192 },
		{ noteID: '01', position: 80 / 192 }
	]);
	const measure = quantizeMeasure(0, [snare]);

	expect(measure.entries.slice(0, 4)).toEqual([
		{ kind: 'note', startTick: 0, durTicks: 48, keys: ['c/5'] },
		{ kind: 'note', startTick: 48, durTicks: 16, keys: ['c/5'] },
		{ kind: 'note', startTick: 64, durTicks: 16, keys: ['c/5'] },
		{ kind: 'note', startTick: 80, durTicks: 16, keys: ['c/5'] }
	]);
	expect(measure.tuplets).toEqual([
		{
			startIndex: 1,
			count: 3,
			numNotes: 3,
			notesOccupied: 2,
			slotTicks: 16,
			baseDurTicks: 24
		}
	]);
});

it('does not infer a trailing triplet rest from an isolated 16-tick pair', () => {
	const snare = new LaneMeasureNote(0, '12', [
		{ noteID: '01', position: 0 },
		{ noteID: '01', position: 16 / 192 }
	]);
	const measure = quantizeMeasure(0, [snare]);

	expect(measure.tuplets).toEqual([]);
	expect(measure.entries[0]).toMatchObject({
		kind: 'note',
		startTick: 0,
		durTicks: 12
	});
	expect(measure.entries[1]).toMatchObject({
		kind: 'rest',
		startTick: 12,
		durTicks: 4
	});
});
```

- [ ] **Step 2: Run the common quantizer tests to verify failure**

Run:

```bash
rtk bun run --filter=@dtx/common test -- quantize.test.ts
```

Expected: FAIL. Before the implementation, the new tests fail because `NotationMeasure` has no `tuplets` field and 16-tick triplet spans still engrave through binary fallback.

- [ ] **Step 3: Add the notation tuplet model**

In `packages/common/src/lib/notation/model.ts`, add `NotationTuplet` before `NotationMeasure`, and add `tuplets` to `NotationMeasure`:

```ts
export interface NotationTuplet {
	startIndex: number;
	count: number;
	numNotes: 3;
	notesOccupied: 2;
	slotTicks: number;
	baseDurTicks: number;
}

export interface NotationMeasure {
	index: number;
	measureTicks: number;
	beatsPerMeasure: number;
	entries: NotationEntry[];
	tuplets: NotationTuplet[];
}
```

In `packages/common/src/lib/index.ts`, add `type NotationTuplet` to the notation model export block:

```ts
export {
	TICKS_PER_WHOLE,
	type NotationNoteEntry,
	type NotationRestEntry,
	type NotationEntry,
	type NotationTuplet,
	type NotationMeasure,
	type NotationChart
} from './notation/model';
```

- [ ] **Step 4: Add triplet detection helpers to the quantizer**

In `packages/common/src/lib/notation/quantize.ts`, import `NotationTuplet`:

```ts
import {
	TICKS_PER_WHOLE,
	type NotationEntry,
	type NotationTuplet,
	type NotationMeasure,
	type NotationChart
} from './model';
```

Replace the HPA-116 binary-only comment above `DURATION_TABLE` with this shorter comment:

```ts
/**
 * Representable binary single durations, largest first: [ticks, vexflowCode].
 * Triplet groups are detected separately and rendered with these binary base
 * durations inside VexFlow Tuplet objects.
 */
```

Add these helpers after the `Onset` interface:

```ts
const TRIPLET_GROUP_TICKS = [48, 96, 192] as const;

interface TripletCandidate {
	groupTicks: number;
	groupEnd: number;
	slotTicks: number;
	baseDurTicks: number;
	slotStarts: [number, number, number];
	occupiedCount: number;
	observedEnd: boolean;
}

const findNextOnsetTick = (onsets: Onset[], tick: number, measureTicks: number): number =>
	onsets.find((onset) => onset.tick > tick)?.tick ?? measureTicks;

const findTripletCandidate = (
	cursor: number,
	onsets: Onset[],
	onsetByTick: ReadonlyMap<number, Onset>,
	measureTicks: number
): TripletCandidate | undefined => {
	const candidates: TripletCandidate[] = [];

	for (const groupTicks of TRIPLET_GROUP_TICKS) {
		const slotTicks = groupTicks / 3;
		const groupEnd = cursor + groupTicks;
		if (!Number.isInteger(slotTicks) || groupEnd > measureTicks) continue;

		const slotStarts = [cursor, cursor + slotTicks, cursor + slotTicks * 2] as [
			number,
			number,
			number
		];
		const slotStartSet = new Set<number>(slotStarts);
		const hasOffSlotOnset = onsets.some(
			(onset) => onset.tick > cursor && onset.tick < groupEnd && !slotStartSet.has(onset.tick)
		);
		if (hasOffSlotOnset) continue;

		const occupiedSlots = slotStarts.map((tick) => onsetByTick.has(tick));
		const occupiedCount = occupiedSlots.filter(Boolean).length;
		if (occupiedCount < 2) continue;

		const observedEnd = groupEnd === measureTicks || onsetByTick.has(groupEnd);
		if (!occupiedSlots[2] && !observedEnd) continue;

		candidates.push({
			groupTicks,
			groupEnd,
			slotTicks,
			baseDurTicks: groupTicks / 2,
			slotStarts,
			occupiedCount,
			observedEnd
		});
	}

	return candidates.sort(
		(a, b) =>
			b.occupiedCount - a.occupiedCount ||
			Number(b.observedEnd) - Number(a.observedEnd) ||
			a.groupTicks - b.groupTicks
	)[0];
};
```

- [ ] **Step 5: Replace the measure walk with triplet-aware output**

In `quantizeMeasure()`, keep onset collection and `pushRests()` intact, then change the output section so it initializes `tuplets`, returns `tuplets: []` for empty measures, and walks with a cursor.

Use this structure after `pushRests()`:

```ts
const tuplets: NotationTuplet[] = [];
const onsetByTick = new Map<number, Onset>(onsets.map((onset) => [onset.tick, onset]));

if (onsets.length === 0) {
	// Decompose the empty bar via pushRests so non-4/4 measures render with
	// rests that sum to the whole bar (e.g. 3/4 = 144 ticks -> half + quarter
	// rest). A single-rest push with durTicks=144 would fall through
	// NotationView's TICK_CODE lookup (no exact match) and render as a lone
	// half rest, misrepresenting the bar length. pushRests skips sub-3-tick
	// spans, so fall back to a single rest when it produces nothing — keeping
	// at least one entry for VexFlow to render.
	pushRests(0, measureTicks);
	if (entries.length === 0) {
		entries.push({ kind: 'rest', startTick: 0, durTicks: measureTicks });
	}
	return { index, measureTicks, beatsPerMeasure, entries, tuplets };
}

let cursor = 0;
while (cursor < measureTicks) {
	const triplet = findTripletCandidate(cursor, onsets, onsetByTick, measureTicks);
	if (triplet) {
		const startIndex = entries.length;
		for (const slotStart of triplet.slotStarts) {
			const onset = onsetByTick.get(slotStart);
			if (onset) {
				entries.push({
					kind: 'note',
					startTick: slotStart,
					durTicks: triplet.slotTicks,
					keys: onset.keys
				});
			} else {
				entries.push({ kind: 'rest', startTick: slotStart, durTicks: triplet.slotTicks });
			}
		}
		tuplets.push({
			startIndex,
			count: 3,
			numNotes: 3,
			notesOccupied: 2,
			slotTicks: triplet.slotTicks,
			baseDurTicks: triplet.baseDurTicks
		});
		cursor = triplet.groupEnd;
		continue;
	}

	const onset = onsetByTick.get(cursor);
	if (onset) {
		const nextTick = findNextOnsetTick(onsets, cursor, measureTicks);
		const span = nextTick - cursor;
		const codes = ticksToDurations(span);
		const noteDur = codes.length ? DURATION_TABLE.find(([, c]) => c === codes[0])![0] : span;
		entries.push({ kind: 'note', startTick: cursor, durTicks: noteDur, keys: onset.keys });
		if (span - noteDur > 0) pushRests(cursor + noteDur, span - noteDur);
		cursor = nextTick;
		continue;
	}

	const nextTick = findNextOnsetTick(onsets, cursor, measureTicks);
	pushRests(cursor, nextTick - cursor);
	cursor = nextTick;
}

return { index, measureTicks, beatsPerMeasure, entries, tuplets };
```

- [ ] **Step 6: Update existing exact expectations for `tuplets: []`**

In `packages/common/src/lib/notation/quantize.test.ts`, add `tuplets: []` to any exact `NotationMeasure` shape assertion that now compares the whole object. The existing `entries`-only assertions do not need changes.

For the empty 3/4 measure test, keep the `entries` expectation as-is:

```ts
expect(measure.entries).toEqual([
	{ kind: 'rest', startTick: 0, durTicks: 96 },
	{ kind: 'rest', startTick: 96, durTicks: 48 }
]);
expect(measure.tuplets).toEqual([]);
```

- [ ] **Step 7: Run common tests and type check**

Run:

```bash
rtk bun run --filter=@dtx/common test -- quantize.test.ts
rtk bun run --filter=@dtx/common check
```

Expected: PASS for both commands.

- [ ] **Step 8: Commit common changes**

Run:

```bash
rtk git add packages/common/src/lib/notation/model.ts
rtk git add packages/common/src/lib/index.ts
rtk git add packages/common/src/lib/notation/quantize.ts
rtk git add packages/common/src/lib/notation/quantize.test.ts
rtk git commit -m "feat(common): add notation triplet quantization"
```

Expected: commit succeeds.

---

### Task 2: Web VexFlow Tuplet Rendering

**Files:**

- Modify: `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
- Test: `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
- Test: `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`
- Test fixture: `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`

**Interfaces:**

- Consumes:
    - `NotationMeasure.tuplets: NotationTuplet[]`
    - `NotationTuplet.baseDurTicks` to choose VexFlow duration codes for covered entries.
- Produces:
    - VexFlow `Tuplet` objects created from `notes.slice(startIndex, startIndex + count)`.
    - Tuplets drawn after beams.

- [ ] **Step 1: Extend the NotationView VexFlow test mock**

In `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`, add hoisted tuplet capture state next to the existing `staveNoteArgs` and `generateBeamsCalls`:

```ts
const tupletArgs = vi.hoisted(
	() =>
		[] as Array<{
			notes: unknown[];
			options: { num_notes: number; notes_occupied: number };
		}>
);
const tupletDraw = vi.hoisted(() => vi.fn());
```

Inside the `vi.mock('vexflow', () => { ... return { ... } })` return object, add `Tuplet`:

```ts
		Tuplet: class {
			constructor(
				notes: unknown[],
				options: { num_notes: number; notes_occupied: number }
			) {
				tupletArgs.push({ notes, options });
			}
			setContext() {
				return this;
			}
			draw() {
				tupletDraw();
			}
		},
```

Clear the new captures in every `beforeEach()` that clears VexFlow mock state:

```ts
tupletArgs.length = 0;
tupletDraw.mockClear();
```

- [ ] **Step 2: Add `tuplets: []` to existing typed chart fixtures**

In `packages/dtx-web/src/lib/components/preview/NotationView.test.ts` and `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`, every object typed as `NotationChart` must include `tuplets` on each measure.

Use this exact shape for existing non-triplet fixtures:

```ts
{
	index: 0,
	measureTicks: 192,
	beatsPerMeasure: 4,
	entries: [{ kind: 'note', startTick: 0, durTicks: 48, keys: ['c/5'] }],
	tuplets: []
}
```

In `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`, update `readyChart()`:

```ts
const readyChart = () => ({
	chart: {
		measures: [{ index: 0, measureTicks: 192, beatsPerMeasure: 4, entries: [], tuplets: [] }]
	},
	timing: {
		totalDuration: 2,
		measureStartSeconds: [0],
		positionToTime: () => 0,
		timeToPosition: () => ({ measure: 0, fraction: 0 })
	},
	notesByLane: {},
	measureCount: 1
});
```

- [ ] **Step 3: Add failing renderer coverage for tuplet duration mapping and drawing**

Add this test to the first `describe('NotationView', () => { ... })` block in `NotationView.test.ts`:

```ts
it('renders triplet-covered entries with base durations and draws a VexFlow Tuplet', async () => {
	const tripletChart: NotationChart = {
		measures: [
			{
				index: 0,
				measureTicks: 192,
				beatsPerMeasure: 4,
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5'] },
					{ kind: 'rest', startTick: 16, durTicks: 16 },
					{ kind: 'note', startTick: 32, durTicks: 16, keys: ['c/5'] }
				],
				tuplets: [
					{
						startIndex: 0,
						count: 3,
						numNotes: 3,
						notesOccupied: 2,
						slotTicks: 16,
						baseDurTicks: 24
					}
				]
			}
		]
	};

	render(NotationView, { props: { chart: tripletChart } });
	await tick();

	expect(staveNoteArgs.map((a) => a.duration)).toEqual(['8', '8r', '8']);
	expect(tupletArgs).toHaveLength(1);
	expect(tupletArgs[0].notes).toHaveLength(3);
	expect(tupletArgs[0].options).toEqual({ num_notes: 3, notes_occupied: 2 });
	expect(tupletDraw).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run the NotationView test to verify failure**

Run:

```bash
rtk bun run --filter=dtx-web test -- NotationView.test.ts
```

Expected: FAIL. Before renderer changes, the test sees `['16', '16r', '16']` and no `Tuplet` construction.

- [ ] **Step 5: Import VexFlow Tuplet and map tuplet base durations**

In `packages/dtx-web/src/lib/components/preview/NotationView.svelte`, change the VexFlow import:

```ts
import { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Tuplet } from 'vexflow';
```

Rename `ticksToRestCode` to `ticksToVexflowCode` and update its callers. Then replace `toStaveNotes` with a tuplet-aware version:

```ts
const tupletBaseDurTicksByEntry = (measure: NotationMeasure): Map<number, number> => {
	const covered = new Map<number, number>();
	for (const tuplet of measure.tuplets) {
		for (let offset = 0; offset < tuplet.count; offset++) {
			covered.set(tuplet.startIndex + offset, tuplet.baseDurTicks);
		}
	}
	return covered;
};

const toStaveNotes = (measure: NotationMeasure): StaveNote[] => {
	const tupletDurTicks = tupletBaseDurTicksByEntry(measure);
	return measure.entries.map((entry, idx) => {
		const durationTicks = tupletDurTicks.get(idx) ?? entry.durTicks;
		if (entry.kind === 'rest') {
			// Rest position is cosmetic; b/4 is the conventional rest line.
			const code = ticksToVexflowCode(durationTicks);
			return new StaveNote({ keys: ['b/4'], duration: `${code}r` });
		}
		const code = ticksToVexflowCode(durationTicks);
		return new StaveNote({ keys: entry.keys, duration: code });
	});
};
```

The renamed duration lookup should keep the same body:

```ts
const ticksToVexflowCode = (ticks: number): string => {
	const exact = TICK_CODE[ticks];
	if (exact) return exact;
	const entry = TICK_ENTRIES.find(([t]) => t <= ticks);
	return entry ? entry[1] : '64';
};
```

- [ ] **Step 6: Create and draw VexFlow tuplets before beam generation**

In `renderChart()`, immediately after `const notes = toStaveNotes(measure);`, create tuplets:

```ts
const tuplets = measure.tuplets.map(
	(tuplet) =>
		new Tuplet(notes.slice(tuplet.startIndex, tuplet.startIndex + tuplet.count), {
			num_notes: tuplet.numNotes,
			notes_occupied: tuplet.notesOccupied
		})
);
```

Keep `const beams = noteGroups.flatMap((group) => Beam.generateBeams(group));` after this block so VexFlow can inspect attached tuplets while beaming.

After the existing beam draw line:

```ts
beams.forEach((b) => b.setContext(context).draw());
```

add:

```ts
tuplets.forEach((tuplet) => tuplet.setContext(context).draw());
```

- [ ] **Step 7: Extend the NotationView error-test VexFlow mock**

In `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`, add `Tuplet` to the mocked `vexflow` return object so the component import resolves:

```ts
		Tuplet: class {
			constructor(_notes: unknown[], _options: unknown) {}
			setContext() {
				return this;
			}
			draw() {}
		},
```

Add `tuplets: []` to the single `chart` fixture measure:

```ts
entries: [{ kind: 'note', startTick: 0, durTicks: 48, keys: ['c/5'] }],
tuplets: []
```

- [ ] **Step 8: Run web component tests**

Run:

```bash
rtk bun run --filter=dtx-web test -- NotationView.test.ts
rtk bun run --filter=dtx-web test -- NotationView.errors.test.ts
```

Expected: PASS for both commands.

- [ ] **Step 9: Commit web renderer changes**

Run:

```bash
rtk git add packages/dtx-web/src/lib/components/preview/NotationView.svelte
rtk git add packages/dtx-web/src/lib/components/preview/NotationView.test.ts
rtk git add packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts
rtk git add 'packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts'
rtk git commit -m "feat(web): render notation tuplets"
```

Expected: commit succeeds.

---

### Task 3: Final Scoped Verification

**Files:**

- Verify only; no planned source edits.

**Interfaces:**

- Consumes the committed common and web task outputs.
- Produces a clean working tree and test evidence.

- [ ] **Step 1: Run final common checks**

Run:

```bash
rtk bun run --filter=@dtx/common test -- quantize.test.ts
rtk bun run --filter=@dtx/common check
```

Expected: PASS for both commands.

- [ ] **Step 2: Run final web checks**

Run:

```bash
rtk bun run --filter=dtx-web test -- NotationView.test.ts
rtk bun run --filter=dtx-web test -- NotationView.errors.test.ts
rtk bun run --filter=dtx-web check
```

Expected: PASS for all three commands.

- [ ] **Step 3: Inspect git state**

Run:

```bash
rtk git status --short --branch
```

Expected: the branch is ahead by the design commit plus the two implementation commits, with no unstaged or staged changes.

- [ ] **Step 4: Report completion**

Final response should include:

```text
Implemented HPA-116 triplet duration support in the notation model, quantizer, and VexFlow renderer.
Verified with:
- bun run --filter=@dtx/common test -- quantize.test.ts
- bun run --filter=@dtx/common check
- bun run --filter=dtx-web test -- NotationView.test.ts
- bun run --filter=dtx-web test -- NotationView.errors.test.ts
- bun run --filter=dtx-web check
```
