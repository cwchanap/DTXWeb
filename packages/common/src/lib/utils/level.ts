/**
 * Decode a single raw `dtx_files.level` to its two-decimal display string.
 *
 * The canonical storage contract is an encoded integer on the ×10 scale
 * (e.g. 50 == 5.0, 55 == 5.5) or the ×100 scale (values > 100, e.g. 550 == 5.5).
 * The GraphQL schema exposes `level` as a `Float`, so a stray decimal (e.g. 5.5)
 * can arrive even though the canonical form is encoded; a non-integer is already
 * on the display scale and is returned as-is rather than divided again.
 *
 * Bare single-digit integers (1–9) are decoded on the ×100 scale (0.01–0.09),
 * not the ×10 scale. DTX levels range 0.1–9.99, so 0.01–0.09 is below the
 * minimum — a bare 1–9 is therefore unambiguously a legacy display-scale value
 * (pre-b2ccaaab desktop uploader) that was never encoded, not an intentional
 * sub-0.1 level. D1 migration 0004 multiplies such rows by 100 to put them on
 * the ×100 scale (5 → 500 → 5.0); after it runs, a bare 1–9 reaching this
 * function is a data-entry error or a pre-migration row that escaped the fix.
 */
export const formatLevel = (level: string | number | undefined | null): string => {
	const parsed = typeof level === 'string' ? parseFloat(level) : (level ?? 0);
	const n = Number.isFinite(parsed) ? parsed : 0;
	const display = Number.isInteger(n) ? (n >= 10 && n <= 100 ? n / 10 : n / 100) : n;
	return display.toFixed(2);
};
