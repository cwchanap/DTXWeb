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
