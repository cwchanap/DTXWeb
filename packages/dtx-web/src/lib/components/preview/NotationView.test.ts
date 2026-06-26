import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import NotationView from './NotationView.svelte';
import type { NotationChart } from '@dtx/common';

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
