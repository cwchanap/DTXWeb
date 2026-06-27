// packages/dtx-web/src/lib/components/preview/cursorGeometry.test.ts
import { describe, it, expect } from 'vitest';
import { cursorPoint, clickToFraction, type MeasureGeometry } from './cursorGeometry';

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

describe('clickToFraction', () => {
	it('maps an x within a measure back to {measure, fraction}', () => {
		// x=130 in measure 0 -> fraction 0.5; y within row 0.
		expect(clickToFraction(130, 30, geo)).toEqual({ measure: 0, fraction: 0.5 });
	});

	it('returns null when the click is outside all measures', () => {
		expect(clickToFraction(9999, 9999, geo)).toBeNull();
	});
});
