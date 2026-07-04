# Open hi-hat (lane 18) distinct rendering in `/preview`

**Date:** 2026-07-04
**Status:** Approved design (pre-implementation)
**Linear:** HPA-119
**Package(s):** `@dtx/common`

## Context

The `/preview` notation viewer renders the open hi-hat (DTX lane `18`) identically
to the closed hi-hat (lane `11`) — both use VexFlow key `g/5/x2`, which maps to a
plain x-notehead (`noteheadXBlack`). Players cannot tell when to strike an open vs
closed hi-hat. This was an accepted v1 scope cut, now being lifted.

## Finding

VexFlow's key-string suffix encodes the notehead type
(`node_modules/vexflow/src/tables.ts`, `keyProperties` + `codeNoteHead`):

| Key suffix | type code | glyph             | meaning   |
| ---------- | --------- | ----------------- | --------- |
| `/x2`      | `X2`      | `noteheadXBlack`  | plain x   |
| `/x3`      | `X3`      | `noteheadCircleX` | circled-x |

The circled-x is the standard drum-notation symbol for open hi-hat, and VexFlow
renders it natively. The existing pipeline (`quantize` → `NotationNoteEntry.keys[]`
→ `NotationView` → `StaveNote`) passes the key string straight through to VexFlow
unchanged, so changing only the suffix is sufficient.

## Design

### Single code change

`packages/common/src/lib/notation/drumMapping.ts` — lane `18` key `g/5/x2` → `g/5/x3`:

```ts
'18': { key: 'g/5/x3', name: 'HH' }, // open hi-hat (circled-x)
```

Update the file's header comment (which currently states "open hi-hat (18) renders
identically to closed (11) in v1") and the per-line comment.

### Why no model / quantize / NotationView changes

- `NotationNoteEntry.keys: string[]` already carries the full key — `g/5/x3`
  propagates identically to `g/5/x2`.
- `quantize.ts` already does `byTick.get(tick)!.add(staff.key)` — distinct keys stay
  distinct in the chord set.
- `NotationView.svelte`'s `toStaveNotes` already passes `entry.keys` to
  `new StaveNote({ keys: entry.keys, ... })` — VexFlow renders the circled-x glyph
  from the `/x3` suffix automatically. No modifier, articulation, or custom drawing
  is needed.

The key suffix **is** the open-hi-hat marker. No new field on `DrumStaff`, no new
property on `NotationNoteEntry`, no rendering branch in `NotationView`.

### Edge case: open + closed hi-hat at the same tick

Both keys land in one chord (`['g/5/x2', 'g/5/x3']`). VexFlow offsets two same-line
noteheads via its displacement logic — the same behavior as any two same-line keys
today. This is rare in real charts (striking open and closed hi-hat simultaneously)
and is not a regression.

## Tests (acceptance criteria)

1. **`drumMapping.test.ts`** — lane `18` maps to `{ key: 'g/5/x3', name: 'HH' }`,
   distinct from lane `11`'s `{ key: 'g/5/x2', name: 'HHC' }`.
2. **`quantize.test.ts`** — an open-hi-hat onset produces `keys: ['g/5/x3']`; a chord
   with both open (18) and closed (11) hi-hat at one tick yields both keys.
3. **`NotationView.test.ts`** — a chart entry with `keys: ['g/5/x3']` passes that key
   to the (mocked) `StaveNote` constructor (assert via `staveNoteArgs`).

No regression to the existing tests in those three files.

## Out of scope

- Pedal hi-hat (lane `1B`) is already distinct (`d/4/x2`, below the staff) — no change.
- No visual / screenshot regression test (VexFlow is mocked in unit tests; the glyph
  rendering is exercised manually in the running app).
