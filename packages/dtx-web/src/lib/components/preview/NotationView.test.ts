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
		constructor(_: unknown) {}
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
		Beam: { generateBeams: () => [] },
		Stem: { UP: 1, DOWN: -1 }
	};
});

const chart: NotationChart = {
	measures: [
		{
			index: 0,
			measureTicks: 192,
			beatsPerMeasure: 4,
			entries: [{ kind: 'note', startTick: 0, durTicks: 48, keys: ['c/5'] }]
		}
	]
};

describe('NotationView', () => {
	beforeEach(() => {
		draw.mockClear();
		setContext.mockClear();
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
			]
		},
		// Measures 1..4 are rest-only (no onsets) so they pad row 0 and let us
		// test the "no active onset" + "no point" highlight paths.
		...Array.from({ length: 4 }, (_, i) => ({
			index: i + 1,
			measureTicks: 192,
			beatsPerMeasure: 4,
			entries: [{ kind: 'rest' as const, startTick: 0, durTicks: 192 }]
		})),
		// Measure 5 wraps to row 1 and has a note for the autoscroll test.
		{
			index: 5,
			measureTicks: 192,
			beatsPerMeasure: 4,
			entries: [{ kind: 'note', startTick: 0, durTicks: 48, keys: ['c/5'] }]
		}
	]
};

describe('NotationView layout & interaction', () => {
	beforeEach(() => {
		draw.mockClear();
		setContext.mockClear();
	});

	it('renders rest entries (rest branch of toStaveNotes)', () => {
		render(NotationView, { props: { chart: richChart } });
		// A rest entry produces a StaveNote with a duration ending in 'r'. The
		// mock StaveNote constructor is a no-op, so we just assert no throw and
		// that drawing happened (the rest branch ran without error).
		expect(draw).toHaveBeenCalled();
	});

	it('wraps measures into multiple rows and justifies non-last rows', () => {
		// 6 measures at 160px each over an 880px usable width -> 2 rows. The
		// justify loop scales row 0 (non-last) to fill the width.
		render(NotationView, { props: { chart: richChart } });
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
