// packages/dtx-web/src/lib/components/preview/cursorGeometry.test.ts
import { describe, it, expect } from 'vitest';
import {
	cursorPoint,
	clickToFraction,
	playheadAt,
	snapToOnset,
	type MeasureGeometry,
	type NoteOnset
} from './cursorGeometry';

const geo: MeasureGeometry[] = [
	{ index: 0, systemRow: 0, xStart: 30, xEnd: 230, top: 20, height: 140 },
	{ index: 1, systemRow: 0, xStart: 230, xEnd: 430, top: 20, height: 140 }
];

describe('cursorPoint', () => {
	it('interpolates x within a measure by fraction', () => {
		expect(cursorPoint(0, 0.5, geo)).toEqual({ x: 130, top: 20, height: 140, systemRow: 0 });
	});

	it('returns the measure start at fraction 0', () => {
		expect(cursorPoint(1, 0, geo)?.x).toBe(230);
	});

	it('returns null for an unknown measure', () => {
		expect(cursorPoint(9, 0, geo)).toBeNull();
	});
});

describe('playheadAt', () => {
	// Deliberately non-linear layout: a linear stave mapping would place the
	// fraction-0.25 cursor at x=80 (30 + 0.25*200), but interpolating across the
	// note centers (50 and 150) puts it at 100.
	const onsets: NoteOnset[] = [
		{ measure: 0, position: 0, x: 40, w: 20 }, // center 50
		{ measure: 0, position: 0.5, x: 140, w: 20 } // center 150
	];

	it('interpolates the cursor across rendered note centers, not the stave', () => {
		const r = playheadAt(0, 0.25, geo, onsets);
		expect(r?.x).toBeCloseTo(100, 5);
		expect(r?.active?.position).toBe(0); // still on the first note
	});

	it('sits on a note center and marks it active at its exact onset', () => {
		const r = playheadAt(0, 0.5, geo, onsets);
		expect(r?.x).toBeCloseTo(150, 5);
		expect(r?.active?.position).toBe(0.5);
	});

	it('glides from the last onset to the stave end after the final note', () => {
		// active = onset@0.5 (center 150); halfway to xEnd (230) -> 190.
		const r = playheadAt(0, 0.75, geo, onsets);
		expect(r?.x).toBeCloseTo(190, 5);
		expect(r?.active?.position).toBe(0.5);
	});

	it('glides from the stave start to the first onset, with no active note', () => {
		const late: NoteOnset[] = [{ measure: 0, position: 0.25, x: 100, w: 20 }]; // center 110
		// before the first onset: 30 + (0.1/0.25)*(110-30) = 62.
		const r = playheadAt(0, 0.1, geo, late);
		expect(r?.x).toBeCloseTo(62, 5);
		expect(r?.active).toBeNull();
	});

	it('falls back to linear interpolation for a measure with no notes', () => {
		const r = playheadAt(1, 0.5, geo, onsets);
		expect(r?.x).toBeCloseTo(330, 5); // 230 + 0.5*(430-230)
		expect(r?.active).toBeNull();
	});

	it('returns null for an unknown measure', () => {
		expect(playheadAt(9, 0, geo, onsets)).toBeNull();
	});
});

describe('snapToOnset', () => {
	const onsets: NoteOnset[] = [
		{ measure: 0, position: 0, x: 40, w: 20 }, // center 50
		{ measure: 0, position: 0.5, x: 140, w: 20 }, // center 150
		{ measure: 1, position: 0.25, x: 240, w: 20 } // center 250
	];

	it('snaps a click to the nearest note center in the measure', () => {
		// x=120 is nearer the position-0.5 note (center 150) than the position-0 note.
		expect(snapToOnset(0, 120, 0.4, onsets)).toBe(0.5);
		// x=70 is nearer the position-0 note (center 50).
		expect(snapToOnset(0, 70, 0.2, onsets)).toBe(0);
	});

	it('only considers notes in the clicked measure', () => {
		// Even though measure 1's note (center 250) is closest in x, measure 0 wins.
		expect(snapToOnset(0, 300, 0.9, onsets)).toBe(0.5);
	});

	it('falls back to the raw fraction when the measure has no notes', () => {
		expect(snapToOnset(2, 100, 0.33, onsets)).toBe(0.33);
	});
});

describe('clickToFraction', () => {
	it('maps an x within a measure back to {measure, fraction}', () => {
		// x=130 in measure 0 -> fraction 0.5; y within row 0.
		expect(clickToFraction(130, 30, geo)).toEqual({ measure: 0, fraction: 0.5 });
	});

	it('returns null when the click is outside all measures', () => {
		expect(clickToFraction(9999, 9999, geo)).toBeNull();
	});
});
