# Open hi-hat distinct rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render DTX open hi-hat (lane 18) as a circled-x notehead, visually distinct from the closed hi-hat (lane 11), in the `/preview` notation viewer.

**Architecture:** VexFlow's key-string suffix encodes the notehead glyph: `/x2` → `noteheadXBlack` (plain x), `/x3` → `noteheadCircleX` (circled-x). The existing pipeline (`quantize` → `NotationNoteEntry.keys[]` → `NotationView` → `StaveNote`) passes the key string through to VexFlow unchanged, so changing only the suffix for lane 18 is the entire code change. Tests are added at each layer to lock in the propagation.

**Tech Stack:** TypeScript, VexFlow 4.2.5, Vitest, Svelte 5.

## Global Constraints

- Tabs for indentation (Prettier: tabs, single quotes, width 100).
- `@dtx/common` is the only package whose source changes; `dtx-web` gets a test-only addition.
- Do NOT run dev servers or build commands. Only run the test commands listed.
- The `__mocks__/` folder already has global mocks; do not create new mocks.

---

## File Structure

- **Modify:** `packages/common/src/lib/notation/drumMapping.ts` — change lane 18 key suffix `g/5/x2` → `g/5/x3`; update header + inline comments. This is the **only** production-code change.
- **Modify:** `packages/common/src/lib/notation/drumMapping.test.ts` — add test asserting lane 18 → `g/5/x3`.
- **Modify:** `packages/common/src/lib/notation/quantize.test.ts` — add tests asserting the open-hat key propagates through quantize and stays distinct in a chord.
- **Modify:** `packages/dtx-web/src/lib/components/preview/NotationView.test.ts` — add test asserting the `g/5/x3` key reaches the (mocked) `StaveNote` constructor.

No new files. No model/quantize/NotationView source changes — the key string carries the marker through the whole stack.

---

### Task 1: drumMapping — circled-x key for lane 18 (core change, TDD)

**Files:**

- Modify: `packages/common/src/lib/notation/drumMapping.ts:9-13` (header comment), `:22` (lane 18 entry)
- Test: `packages/common/src/lib/notation/drumMapping.test.ts`

**Interfaces:**

- Produces: `laneToStaff('18')` now returns `{ key: 'g/5/x3', name: 'HH' }` (was `g/5/x2`). All downstream consumers (`quantize.ts`, `NotationView`) see this via the existing `keys: string[]` flow — no signature changes.

- [ ] **Step 1: Write the failing test**

Add this test to the `describe('laneToStaff')` block in `drumMapping.test.ts`, immediately after the existing "maps closed hi-hat to an x notehead on g/5" test (currently after line 11):

```ts
it('maps open hi-hat to a circled-x notehead on g/5 (distinct from closed)', () => {
	// /x3 suffix -> VexFlow noteheadCircleX; /x2 (closed) -> noteheadXBlack.
	expect(laneToStaff('18')).toEqual({ key: 'g/5/x3', name: 'HH' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=@dtx/common test -- drumMapping.test.ts`
Expected: FAIL — `Expected: {"key": "g/5/x3", "name": "HH"}  Received: {"key": "g/5/x2", "name": "HH"}`

- [ ] **Step 3: Change the lane 18 mapping and update comments**

In `packages/common/src/lib/notation/drumMapping.ts`:

Replace the header comment block (lines 9-13):

```ts
/**
 * DTX drum lane id -> drum-staff position + notehead.
 * Keys ending in '/x2' render an X notehead (cymbals / hi-hats).
 * Note: open hi-hat (18) renders identically to closed (11) in v1.
 */
```

with:

```ts
/**
 * DTX drum lane id -> drum-staff position + notehead.
 * Key suffix selects the notehead glyph: '/x2' -> plain x (cymbals / closed hi-hat),
 * '/x3' -> circled x (open hi-hat).
 */
```

Replace the lane 18 entry (line 22):

```ts
	'18': { key: 'g/5/x2', name: 'HH' }, // open hi-hat (v1: same as closed)
```

with:

```ts
	'18': { key: 'g/5/x3', name: 'HH' }, // open hi-hat (circled-x)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=@dtx/common test -- drumMapping.test.ts`
Expected: PASS — all tests green (the existing lane 11 / `g/5/x2` test still passes; the new lane 18 / `g/5/x3` test passes).

- [ ] **Step 5: Commit**

```bash
git add packages/common/src/lib/notation/drumMapping.ts packages/common/src/lib/notation/drumMapping.test.ts
git commit -m "feat(notation): render open hi-hat (lane 18) as circled-x notehead

VexFlow key suffix /x3 maps to noteheadCircleX, the standard drum-notation
open-hi-hat symbol. Lane 18 was /x2 (same as closed); now /x3. The key
string propagates through quantize/model/NotationView unchanged.

HPA-119"
```

---

### Task 2: quantize — open-hat key propagation regression tests

**Files:**

- Test: `packages/common/src/lib/notation/quantize.test.ts`
- No source changes (quantize.ts already propagates `staff.key`; these tests lock that in).

**Interfaces:**

- Consumes: `laneToStaff('18')` → `{ key: 'g/5/x3', name: 'HH' }` from Task 1.
- Produces: regression coverage proving `quantizeMeasure` emits `g/5/x3` for lane 18 and keeps it distinct from `g/5/x2` in a chord.

- [ ] **Step 1: Write the failing tests**

Add these two tests to the `describe('quantizeMeasure')` block in `quantize.test.ts`, immediately after the "merges simultaneous lanes into a chord" test (currently after line 56):

```ts
it('renders open hi-hat (lane 18) with the circled-x key g/5/x3', () => {
	const openHat = new LaneMeasureNote(0, '18', [{ noteID: '01', position: 0 }]);
	const measure = quantizeMeasure(0, [openHat]);
	const first = measure.entries.find((e) => e.kind === 'note') as { keys: string[] };
	expect(first.keys).toEqual(['g/5/x3']);
});

it('keeps open and closed hi-hat keys distinct in a single chord', () => {
	const closed = new LaneMeasureNote(0, '11', [{ noteID: '01', position: 0 }]);
	const open = new LaneMeasureNote(0, '18', [{ noteID: '01', position: 0 }]);
	const measure = quantizeMeasure(0, [closed, open]);
	const first = measure.entries.find((e) => e.kind === 'note') as { keys: string[] };
	expect(first.keys.sort()).toEqual(['g/5/x2', 'g/5/x3']);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun run --filter=@dtx/common test -- quantize.test.ts`
Expected: PASS — both new tests pass (Task 1 already changed the mapping, so quantize now emits `g/5/x3`). All existing quantize tests still pass.

> Note: These are characterization/regression tests, not driving new code. They document that the open-hat marker survives the chord-grouping `Set<string>` in `quantize.ts` (which dedups identical keys but keeps distinct suffixes). If Task 1 were reverted, these would fail — that is the regression guard.

- [ ] **Step 3: Commit**

```bash
git add packages/common/src/lib/notation/quantize.test.ts
git commit -m "test(notation): lock open-hat key propagation through quantize

HPA-119"
```

---

### Task 3: NotationView — circled-x key reaches StaveNote

**Files:**

- Test: `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
- No source changes (`NotationView.svelte` already passes `entry.keys` to `new StaveNote({ keys: ... })`; this test locks that in).

**Interfaces:**

- Consumes: the mocked `StaveNote` constructor captures `{ keys, duration }` into the `staveNoteArgs` hoisted array (already set up at the top of the test file, line 14). The `NotationChart` type from `@dtx/common`.
- Produces: regression coverage proving a `g/5/x3` entry reaches VexFlow's `StaveNote` — the contract that VexFlow then renders as `noteheadCircleX`.

- [ ] **Step 1: Write the test**

Add this test to the `describe('NotationView')` block (the first describe block, which clears `staveNoteArgs` in its `beforeEach`), after the "renders non-table rest durations..." test (currently after line 187):

```ts
it('passes the circled-x key (g/5/x3) through to StaveNote for open hi-hat entries', async () => {
	// The key suffix /x3 selects VexFlow's noteheadCircleX glyph. NotationView
	// passes entry.keys straight to StaveNote, so this asserts the propagation
	// contract (VexFlow itself is mocked; the glyph rendering is manual-check).
	const openHatChart: NotationChart = {
		measures: [
			{
				index: 0,
				measureTicks: 192,
				beatsPerMeasure: 4,
				entries: [{ kind: 'note', startTick: 0, durTicks: 48, keys: ['g/5/x3'] }]
			}
		]
	};
	render(NotationView, { props: { chart: openHatChart } });
	await tick();
	const openHatNote = staveNoteArgs.find((a) => a.keys.includes('g/5/x3'));
	expect(openHatNote).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun run --filter=dtx-web test -- NotationView.test.ts`
Expected: PASS — `staveNoteArgs` captures the `g/5/x3` key. All existing NotationView tests still pass.

> Note: Same as Task 2, this is a regression guard. The one-line source change in Task 1 already makes the whole stack correct; this test ensures NotationView keeps passing open-hat keys through if it is ever refactored.

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-web/src/lib/components/preview/NotationView.test.ts
git commit -m "test(preview): assert open-hat circled-x key reaches StaveNote

HPA-119"
```

---

## Post-implementation verification

After all three tasks, run the full notation test suites once to confirm no regression:

```bash
bun run --filter=@dtx/common test -- drumMapping.test.ts quantize.test.ts
bun run --filter=dtx-web test -- NotationView.test.ts
```

Expected: all green.

Manual check (optional, not automated): run `bun run dev:web`, open `/preview/<id>` for a chart that uses open hi-hat (lane 18), and confirm the circled-x glyph renders on the hi-hat staff line.
