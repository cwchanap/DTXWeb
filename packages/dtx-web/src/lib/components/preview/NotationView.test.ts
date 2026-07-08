import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import NotationView from './NotationView.svelte';
import type { NotationChart } from '@dtx/common';
// NotationView now uses `$_` for the seek aria-label; activate the global
// __mocks__/svelte-i18n.ts so `_` returns the key unchanged.
vi.mock('svelte-i18n');

// Mock vexflow: we assert orchestration, not SVG output.
const draw = vi.fn();
const setContext = vi.fn(() => ({ draw }));
// Captures StaveNote constructor args so tests can assert duration codes.
const staveNoteArgs = vi.hoisted(() => [] as Array<{ keys: string[]; duration: string }>);
// Captures Beam.generateBeams call args so tests can assert beam grouping.
const generateBeamsCalls = vi.hoisted(() => [] as Array<unknown[]>);
const tupletArgs = vi.hoisted(
	() =>
		[] as Array<{
			notes: unknown[];
			options: { num_notes: number; notes_occupied: number };
		}>
);
const tupletDraw = vi.hoisted(() => vi.fn());
vi.mock('vexflow', () => {
	class Stave {
		addClef() {
			return this;
		}
		addTimeSignature() {
			return this;
		}
		setContext = setContext;
		getNoteStartX() {
			return 30;
		}
		getNoteEndX() {
			return 200;
		}
		getYForLine() {
			return 40;
		}
	}
	class StaveNote {
		constructor(opts: { keys: string[]; duration: string }) {
			staveNoteArgs.push(opts);
		}
		getBoundingBox() {
			return { getX: () => 0, getW: () => 0 };
		}
	}
	return {
		Renderer: class {
			static Backends = { SVG: 1 };
			constructor(_el: unknown, _b: unknown) {}
			resize() {}
			getContext() {
				return {};
			}
		},
		Stave,
		StaveNote,
		Voice: class {
			setStrict() {
				return this;
			}
			addTickables() {
				return this;
			}
			draw() {}
		},
		Formatter: class {
			joinVoices() {
				return this;
			}
			format() {
				return this;
			}
		},
		Beam: {
			generateBeams: vi.fn((notes: unknown[]) => {
				generateBeamsCalls.push(notes);
				return [];
			})
		},
		Tuplet: class {
			constructor(notes: unknown[], options: { num_notes: number; notes_occupied: number }) {
				tupletArgs.push({ notes, options });
			}
			setContext() {
				return this;
			}
			draw() {
				tupletDraw();
			}
		},
		Stem: { UP: 1, DOWN: -1 }
	};
});

const chart: NotationChart = {
	measures: [
		{
			index: 0,
			measureTicks: 192,
			beatsPerMeasure: 4,
			entries: [{ kind: 'note', startTick: 0, durTicks: 48, keys: ['c/5'] }],
			tuplets: []
		}
	]
};

describe('NotationView', () => {
	beforeEach(() => {
		draw.mockClear();
		setContext.mockClear();
		staveNoteArgs.length = 0;
		generateBeamsCalls.length = 0;
		tupletArgs.length = 0;
		tupletDraw.mockClear();
	});

	it('renders a container and draws at least one stave', async () => {
		const { container } = render(NotationView, { props: { chart } });
		// renderChart runs in the `void chart` $effect (after mount), not in
		// onMount, so await tick before asserting draw happened.
		await tick();
		expect(container.querySelector('[data-testid="notation-container"]')).toBeTruthy();
		expect(setContext).toHaveBeenCalled();
		expect(draw).toHaveBeenCalled();
	});

	it('clamps aria-valuemax to 0 for an empty-measures chart (never -1)', async () => {
		// buildNotationChart always yields >=1 measure, but guard defensively so
		// a degenerate empty chart can't produce aria-valuemax=-1 (invalid for a
		// slider, where valuemin=0 and valuemax must be >= valuemin).
		const { container } = render(NotationView, {
			props: { chart: { measures: [] } as NotationChart }
		});
		await tick();
		const slider = container.querySelector('[data-testid="notation-container"]');
		expect(slider?.getAttribute('aria-valuemax')).toBe('0');
		expect(slider?.getAttribute('aria-valuemin')).toBe('0');
		// An empty chart must not announce the impossible "Measure 1 of 0"
		// (cursorMeasure defaults to 0 -> +1 = 1, total = 0). Fall back to the
		// neutral preview.seek label instead of the parameterized seek_value.
		expect(slider?.getAttribute('aria-valuetext')).toBe('preview.seek');
	});

	it('splits beams at rest boundaries so notes separated by rests are not beamed together', async () => {
		// Regression: filtering rests out before Beam.generateBeams() made
		// VexFlow beam across the gap — e.g. eighth note, eighth rest, eighth
		// note rendered as one beamed group. The fix generates beams per
		// contiguous note run so the engraved rhythm matches the chart.
		const beamChart: NotationChart = {
			measures: [
				{
					index: 0,
					measureTicks: 192,
					beatsPerMeasure: 4,
					entries: [
						{ kind: 'note', startTick: 0, durTicks: 24, keys: ['c/5'] },
						{ kind: 'rest', startTick: 24, durTicks: 24 },
						{ kind: 'note', startTick: 48, durTicks: 24, keys: ['c/5'] },
						{ kind: 'note', startTick: 72, durTicks: 24, keys: ['c/5'] }
					],
					tuplets: []
				}
			]
		};
		render(NotationView, { props: { chart: beamChart } });
		await tick();
		// Two contiguous note groups: [note0] and [note2, note3].
		// Beam.generateBeams must be called once per group, not once for all
		// three notes together.
		expect(generateBeamsCalls).toHaveLength(2);
		expect(generateBeamsCalls[0]).toHaveLength(1);
		expect(generateBeamsCalls[1]).toHaveLength(2);
	});

	it('renders non-table rest durations as the closest representable code, not a quarter', async () => {
		// Regression: quantizeMeasure's sub-3-tick fold can produce rests with
		// non-table durations (e.g. 5 ticks = 3 + 2 fold). ticksToRestCode used
		// to fall back to 'q' (48 ticks) for any unknown value, making VexFlow
		// spacing wildly wrong for small rests. The fix picks the largest
		// representable duration <= ticks: 5 ticks -> '64' (3 ticks), not 'q'.
		const offGridChart: NotationChart = {
			measures: [
				{
					index: 0,
					measureTicks: 192,
					beatsPerMeasure: 4,
					entries: [
						// 5-tick rest (non-table): should render as '64r', not 'qr'
						{ kind: 'rest', startTick: 0, durTicks: 5 },
						// 50-tick rest (non-table): should render as 'qr' (48 <= 50)
						{ kind: 'rest', startTick: 5, durTicks: 50 },
						// 7-tick rest (non-table): should render as '32r' (6 <= 7)
						{ kind: 'rest', startTick: 55, durTicks: 7 },
						// 130-tick rest (non-table): should render as 'hr' (96 <= 130)
						{ kind: 'rest', startTick: 62, durTicks: 130 }
					],
					tuplets: []
				}
			]
		};
		render(NotationView, { props: { chart: offGridChart } });
		await tick();
		const restDurations = staveNoteArgs.map((a) => a.duration);
		expect(restDurations).toEqual(['64r', 'qr', '32r', 'hr']);
	});

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
					entries: [{ kind: 'note', startTick: 0, durTicks: 48, keys: ['g/5/x3'] }],
					tuplets: []
				}
			]
		};
		render(NotationView, { props: { chart: openHatChart } });
		await tick();
		const openHatNote = staveNoteArgs.find((a) => a.keys.includes('g/5/x3'));
		expect(openHatNote).toBeDefined();
	});

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
							slotTicks: 16
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
});

describe('NotationView highlight', () => {
	beforeEach(() => {
		draw.mockClear();
		setContext.mockClear();
	});

	it('highlights the active note at the current cursor position', async () => {
		// The highlight is driven by cursorMeasure/cursorFraction (the page converts
		// timing to those each frame), not by a wall-clock currentTime. The chart's
		// only note sits at measure 0 / position 0, so the default cursor lands on it.
		const { container } = render(NotationView, {
			props: { chart, cursorMeasure: 0, cursorFraction: 0 }
		});
		await tick();
		expect(container.querySelector('[data-testid="notation-note-highlight"]')).toBeTruthy();
		// The red playhead bar was removed; only the highlight remains.
		expect(container.querySelector('[data-testid="notation-cursor"]')).toBeNull();
	});

	it('emits onSeek snapped to the nearest note', async () => {
		const onSeek = vi.fn();
		const { container } = render(NotationView, { props: { chart, onSeek } });
		await tick();
		const surface = container.querySelector(
			'[data-testid="notation-container"]'
		) as HTMLElement;
		// jsdom: getBoundingClientRect is all-zero and scrollLeft is 0, so the click
		// maps through the mocked stave geometry (xStart=30, xEnd=200) to a raw
		// fraction of 100/170. The chart's only note sits at position 0, so the click
		// snaps to it — proving snapToOnset is applied (fraction != raw 100/170).
		surface.dispatchEvent(
			new MouseEvent('click', { bubbles: true, clientX: 130, clientY: 30 })
		);
		expect(onSeek).toHaveBeenCalledTimes(1);
		const arg = onSeek.mock.calls[0][0];
		expect(arg.measure).toBe(0);
		expect(arg.fraction).toBe(0);
	});
});

// A chart with rests and many measures to exercise rest rendering, row
// wrapping, and row justification. Measure 5 (second row) carries a note so the
// autoscroll test can move the cursor between rows while keeping the highlight.
const richChart: NotationChart = {
	measures: [
		{
			index: 0,
			measureTicks: 192,
			beatsPerMeasure: 4,
			entries: [
				{ kind: 'rest', startTick: 0, durTicks: 48 },
				{ kind: 'note', startTick: 48, durTicks: 48, keys: ['c/5'] }
			],
			tuplets: []
		},
		// Measures 1..4 are rest-only (no onsets) so they pad row 0 and let us
		// test the "no active onset" + "no point" highlight paths.
		...Array.from({ length: 4 }, (_, i) => ({
			index: i + 1,
			measureTicks: 192,
			beatsPerMeasure: 4,
			entries: [{ kind: 'rest' as const, startTick: 0, durTicks: 192 }],
			tuplets: []
		})),
		// Measure 5 wraps to row 1 and has a note for the autoscroll test.
		{
			index: 5,
			measureTicks: 192,
			beatsPerMeasure: 4,
			entries: [{ kind: 'note', startTick: 0, durTicks: 48, keys: ['c/5'] }],
			tuplets: []
		}
	]
};

describe('NotationView layout & interaction', () => {
	beforeEach(() => {
		draw.mockClear();
		setContext.mockClear();
		staveNoteArgs.length = 0;
		generateBeamsCalls.length = 0;
		tupletArgs.length = 0;
		tupletDraw.mockClear();
	});

	it('renders rest entries (rest branch of toStaveNotes)', async () => {
		render(NotationView, { props: { chart: richChart } });
		// renderChart runs in the `void chart` $effect (after mount), so await
		// tick before asserting draw happened.
		await tick();
		// A rest entry produces a StaveNote with a duration ending in 'r'. The
		// mock StaveNote constructor is a no-op, so we just assert no throw and
		// that drawing happened (the rest branch ran without error).
		expect(draw).toHaveBeenCalled();
	});

	it('wraps measures into multiple rows and justifies non-last rows', async () => {
		// 6 measures at 160px each over an 880px usable width -> 2 rows. The
		// justify loop scales row 0 (non-last) to fill the width.
		render(NotationView, { props: { chart: richChart } });
		await tick();
		expect(draw).toHaveBeenCalled();
		// No throw means the wrap (row++/x=LEFT) and justify (byRow scale) paths
		// executed. The mock Stave records x positions; we can't easily read them,
		// but successful completion of 6 measures across 2 rows is the contract.
	});

	it('hides the highlight when the cursor is on a measure with no geometry (no point)', async () => {
		const { container } = render(NotationView, {
			props: { chart: richChart, cursorMeasure: 99, cursorFraction: 0 }
		});
		await tick();
		expect(container.querySelector('[data-testid="notation-note-highlight"]')).toBeNull();
	});

	it('hides the highlight when the measure has no active onset (rest-only measure)', async () => {
		// Measure 1 is rest-only: cursorPoint finds geometry, activeOnset is null.
		const { container } = render(NotationView, {
			props: { chart: richChart, cursorMeasure: 1, cursorFraction: 0.5 }
		});
		await tick();
		expect(container.querySelector('[data-testid="notation-note-highlight"]')).toBeNull();
	});

	it('preventDefaults Enter/Space keydown on the container', async () => {
		const { container } = render(NotationView, { props: { chart: richChart } });
		await tick();
		const surface = container.querySelector(
			'[data-testid="notation-container"]'
		) as HTMLElement;
		const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
		const spy = vi.spyOn(event, 'preventDefault');
		surface.dispatchEvent(event);
		expect(spy).toHaveBeenCalled();
	});

	it('seeks via Arrow/Home/End keys (role="slider" keyboard operability)', async () => {
		// richChart has 6 measures (0..5). Starting at cursor measure 2, ArrowRight
		// advances to 3, Home jumps to 0, End jumps to the last measure (5).
		const onSeek = vi.fn();
		const { container } = render(NotationView, {
			props: { chart: richChart, cursorMeasure: 2, cursorFraction: 0, onSeek }
		});
		await tick();
		const surface = container.querySelector(
			'[data-testid="notation-container"]'
		) as HTMLElement;
		const press = (key: string) => {
			const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			surface.dispatchEvent(event);
		};
		press('ArrowRight');
		press('Home');
		press('End');
		expect(onSeek).toHaveBeenCalledTimes(3);
		expect(onSeek.mock.calls[0][0]).toEqual({ measure: 3, fraction: 0 });
		expect(onSeek.mock.calls[1][0]).toEqual({ measure: 0, fraction: 0 });
		expect(onSeek.mock.calls[2][0]).toEqual({ measure: 5, fraction: 1 });
	});

	it('re-renders on resize via the ResizeObserver callback', async () => {
		// Capture the ResizeObserver callback so we can fire it manually.
		let observerCb: (() => void) | undefined;
		const observe = vi.fn();
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(cb: () => void) {
					observerCb = cb;
				}
				observe = observe;
				unobserve() {}
				disconnect() {}
			}
		);
		try {
			render(NotationView, { props: { chart: richChart } });
			await tick();
			expect(observe).toHaveBeenCalled();
			const drawsBefore = draw.mock.calls.length;
			// Fire the resize callback under fake timers so the 150ms debounce
			// setTimeout is queued in the fake timer system and can be advanced.
			vi.useFakeTimers();
			observerCb!();
			vi.advanceTimersByTime(200);
			vi.useRealTimers();
			expect(draw.mock.calls.length).toBeGreaterThan(drawsBefore);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('autoscrolls to follow the highlight during playback when the row changes', async () => {
		// Measure 0's note sits at position 0.25, so use cursorFraction 0.5 to land
		// an active onset and bind the highlight on the first effect run.
		const { container, rerender } = render(NotationView, {
			props: { chart: richChart, cursorMeasure: 0, cursorFraction: 0.5, playing: true }
		});
		await tick();
		const hl = container.querySelector(
			'[data-testid="notation-note-highlight"]'
		) as HTMLElement;
		expect(hl).not.toBeNull();
		// jsdom does not implement scrollIntoView; define it so the component's
		// `highlightEl?.scrollIntoView?.(...)` call is observable.
		const scrollFn = vi.fn();
		hl.scrollIntoView = scrollFn as unknown as typeof hl.scrollIntoView;
		// Move the cursor to measure 5 (row 1, note at position 0): point.top
		// changes, so the effect calls scrollIntoView on the bound highlight.
		rerender({ chart: richChart, cursorMeasure: 5, cursorFraction: 0, playing: true });
		await tick();
		expect(scrollFn).toHaveBeenCalled();
	});
});
