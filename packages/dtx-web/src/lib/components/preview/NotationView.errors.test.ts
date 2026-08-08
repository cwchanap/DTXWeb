import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import NotationView from './NotationView.svelte';
import type { NotationChart } from '@dtx/common';

// Activate the global svelte-i18n mock (`_` returns the key unchanged).
vi.mock('svelte-i18n');

// A vexflow mock where StaveNote.getBoundingBox always throws (exercising the
// per-note bounding-box catch) and Voice.draw throws on demand (exercising the
// whole-measure outer catch). `drawThrows` is toggled between tests.
const draw = vi.fn();
const setContext = vi.fn(() => ({ draw }));
let drawThrows = false;
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
	}
	class StaveNote {
		constructor(_: unknown) {}
		// Always throw so the per-note bounding-box capture hits its catch block.
		getBoundingBox() {
			throw new Error('not measurable in jsdom');
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
			draw() {
				if (drawThrows) throw new Error('voice draw failed');
			}
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
		Tuplet: class {
			constructor(_notes: unknown[], _options: unknown) {}
			setContext() {
				return this;
			}
			draw() {}
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
	],
	tempoEvents: []
};

describe('NotationView error paths', () => {
	beforeEach(() => {
		draw.mockClear();
		setContext.mockClear();
		drawThrows = false;
	});

	it('skips unmeasurable note bounding boxes (inner catch) without crashing', async () => {
		// voice.draw succeeds; getBoundingBox throws per note and is swallowed,
		// so renderChart still completes. Asserting setContext (renderChart ran
		// through the draw path) + console.warn NOT called proves the inner
		// catch handled the per-note error while the outer catch stayed silent —
		// not just that the container exists.
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { container } = render(NotationView, { props: { chart } });
		// renderChart runs in the `void chart` $effect (after mount), so await
		// tick before asserting the draw path executed.
		await tick();
		expect(container.querySelector('[data-testid="notation-container"]')).toBeTruthy();
		expect(setContext).toHaveBeenCalled(); // stave.draw ran -> renderChart completed
		expect(draw).toHaveBeenCalled();
		// Inner catch swallowed the getBoundingBox error; the outer catch did not.
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('survives a throwing voice.draw (outer catch) and logs a warning', async () => {
		drawThrows = true;
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { container } = render(NotationView, { props: { chart } });
		// renderChart runs in the `void chart` $effect (after mount), so await
		// tick before asserting the warning fired.
		await tick();
		expect(container.querySelector('[data-testid="notation-container"]')).toBeTruthy();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
