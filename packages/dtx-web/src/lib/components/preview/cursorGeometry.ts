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
 * The playhead's horizontal position and the note it currently sits on.
 *
 * VexFlow lays notes out non-linearly (width scales with duration, plus
 * clef/trailing padding), so a linear `xStart + fraction * width` cursor drifts
 * away from where notes are actually drawn. Interpolating across the rendered
 * onset centers keeps the bar passing exactly through each note at its onset
 * time, so it stays aligned with the highlight. Measures with no notes fall back
 * to linear interpolation across the stave. Returns null if the measure isn't
 * laid out (cursor should hide).
 */
export const playheadAt = (
	measure: number,
	fraction: number,
	geo: MeasureGeometry[],
	onsets: NoteOnset[]
): { x: number; active: NoteOnset | null } | null => {
	const g = geo.find((m) => m.index === measure);
	if (!g) return null;
	const clamped = Math.max(0, Math.min(1, fraction));
	const measureOnsets = onsets.filter((o) => o.measure === measure);
	if (measureOnsets.length === 0) {
		return { x: g.xStart + (g.xEnd - g.xStart) * clamped, active: null };
	}
	const center = (o: NoteOnset) => o.x + o.w / 2;
	let active: NoteOnset | undefined;
	let next: NoteOnset | undefined;
	for (const o of measureOnsets) {
		if (o.position <= clamped + 1e-6) {
			if (!active || o.position > active.position) active = o;
		} else if (!next || o.position < next.position) {
			next = o;
		}
	}
	const lerp = (x0: number, x1: number, t: number) => x0 + t * (x1 - x0);
	if (active && next) {
		const span = next.position - active.position;
		const t = span > 0 ? (clamped - active.position) / span : 0;
		return { x: lerp(center(active), center(next), t), active };
	}
	if (active) {
		// After the last onset: glide from it to the stave's end.
		const span = 1 - active.position;
		const t = span > 0 ? (clamped - active.position) / span : 0;
		return { x: lerp(center(active), g.xEnd, t), active };
	}
	// Before the first onset: glide from the stave start to it.
	const first = next!;
	const t = first.position > 0 ? clamped / first.position : 0;
	return { x: lerp(g.xStart, center(first), t), active: null };
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
