// packages/dtx-web/src/lib/components/preview/cursorGeometry.ts

export interface MeasureGeometry {
	index: number;
	systemRow: number;
	xStart: number;
	xEnd: number;
	top: number;
	height: number;
}

export interface CursorPoint {
	x: number;
	top: number;
	height: number;
	systemRow: number;
}

/** A note's rendered horizontal extent, keyed by its musical position. */
export interface NoteOnset {
	measure: number;
	/** Onset time within the measure, 0..1. */
	position: number;
	/** Left edge of the rendered note bounding box. */
	x: number;
	/** Rendered width of the note bounding box. */
	w: number;
}

export const cursorPoint = (
	measure: number,
	fraction: number,
	geo: MeasureGeometry[]
): CursorPoint | null => {
	const g = geo.find((m) => m.index === measure);
	if (!g) return null;
	const clamped = Math.max(0, Math.min(1, fraction));
	return {
		x: g.xStart + (g.xEnd - g.xStart) * clamped,
		top: g.top,
		height: g.height,
		systemRow: g.systemRow
	};
};

/**
 * The note currently under the playhead: the latest onset in the measure at or
 * before the given fraction, or null when the measure has no earlier note (e.g.
 * a rest-only intro, or before the first note).
 */
export const activeOnset = (
	measure: number,
	fraction: number,
	onsets: NoteOnset[]
): NoteOnset | null => {
	let active: NoteOnset | null = null;
	for (const o of onsets) {
		if (o.measure !== measure) continue;
		if (o.position > fraction + 1e-6) continue;
		if (!active || o.position > active.position) active = o;
	}
	return active;
};

/**
 * Snap a clicked position to the nearest note onset in the measure (by rendered
 * x center), returning that note's musical position. This lands the cursor and
 * the highlight on the same note instead of leaving the bar between notes (the
 * linear click mapping and the non-linear note layout don't otherwise agree).
 * Falls back to the raw fraction when the measure has no notes.
 */
export const snapToOnset = (
	measure: number,
	contentX: number,
	fraction: number,
	onsets: NoteOnset[]
): number => {
	let best: NoteOnset | undefined;
	let bestDist = Infinity;
	for (const o of onsets) {
		if (o.measure !== measure) continue;
		const dist = Math.abs(o.x + o.w / 2 - contentX);
		if (dist < bestDist) {
			bestDist = dist;
			best = o;
		}
	}
	return best ? best.position : fraction;
};

/** clientX/clientY are coordinates RELATIVE to the notation container. */
export const clickToFraction = (
	clientX: number,
	clientY: number,
	geo: MeasureGeometry[]
): { measure: number; fraction: number } | null => {
	const hit = geo.find(
		(g) =>
			clientX >= g.xStart &&
			clientX <= g.xEnd &&
			clientY >= g.top &&
			clientY <= g.top + g.height
	);
	if (!hit) return null;
	const fraction = (clientX - hit.xStart) / (hit.xEnd - hit.xStart);
	return { measure: hit.index, fraction: Math.max(0, Math.min(1, fraction)) };
};
