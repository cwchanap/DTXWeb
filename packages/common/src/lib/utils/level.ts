/**
 * Decode a single raw `dtx_files.level` to its two-decimal display string.
 *
 * The canonical storage contract is an encoded integer on the ×10 scale
 * (e.g. 50 == 5.0, 55 == 5.5) or the ×100 scale (values > 100, e.g. 550 == 5.5).
 * The GraphQL schema exposes `level` as a `Float`, so a stray decimal (e.g. 5.5)
 * can arrive even though the canonical form is encoded; a non-integer is already
 * on the display scale and is returned as-is rather than divided again.
 */
export const formatLevel = (level: string | number | undefined | null): string => {
	const parsed = typeof level === 'string' ? parseFloat(level) : (level ?? 0);
	const n = Number.isFinite(parsed) ? parsed : 0;
	const display = Number.isInteger(n) ? (n > 100 ? n / 100 : n / 10) : n;
	return display.toFixed(2);
};
