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

	it('renders a container and draws at least one stave', () => {
		const { container } = render(NotationView, { props: { chart } });
		expect(container.querySelector('[data-testid="notation-container"]')).toBeTruthy();
		expect(setContext).toHaveBeenCalled();
		expect(draw).toHaveBeenCalled();
	});
});

describe('NotationView cursor', () => {
	beforeEach(() => {
		draw.mockClear();
		setContext.mockClear();
	});

	it('renders a cursor element', async () => {
		const { container } = render(NotationView, { props: { chart, currentTime: 0 } });
		await tick();
		expect(container.querySelector('[data-testid="notation-cursor"]')).toBeTruthy();
	});

	it('emits onSeek with the clicked measure and fraction', async () => {
		const onSeek = vi.fn();
		const { container } = render(NotationView, { props: { chart, onSeek } });
		await tick();
		const surface = container.querySelector(
			'[data-testid="notation-container"]'
		) as HTMLElement;
		// jsdom: getBoundingClientRect is all-zero and scrollLeft is 0, so the click
		// maps directly through the mocked stave geometry (xStart=30, xEnd=200, top=20,
		// height=140): clickToFraction(130, 30) -> measure 0, fraction 100/170.
		surface.dispatchEvent(
			new MouseEvent('click', { bubbles: true, clientX: 130, clientY: 30 })
		);
		expect(onSeek).toHaveBeenCalledTimes(1);
		const arg = onSeek.mock.calls[0][0];
		expect(arg.measure).toBe(0);
		expect(arg.fraction).toBeCloseTo(100 / 170, 5);
	});
});
