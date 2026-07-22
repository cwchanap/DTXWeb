/**
 * Normalize a raw `dtx_files.level` (and optional `levelDec`) to the display
 * scale, matching DTXManiaCX's canonical encoding:
 *
 *   level >= 100 → level / 100                    (e.g. 850 → 8.50)
 *   level <  100 → level / 10 + levelDec / 100    (e.g. 78 + 33 → 8.13)
 *
 * The cloud `dtx_files.level` column stores a single encoded integer with no
 * separate decimal component, so `levelDec` defaults to 0 — the ×10 branch
 * (level < 100, levelDec = 0) decodes 55 → 5.50, matching the ×10 contract.
 *
 * The GraphQL schema exposes `level` as a `Float`, so a stray decimal (e.g.
 * 5.5) can arrive even though the canonical form is encoded; a non-integer is
 * already on the display scale and is returned as-is rather than divided
 * again.
 *
 * Reference: DTXManiaCX `SongScore.CalculateGameSkill` / `SkillPanelDisplay.
 * FormatLevelText` — `level >= 100 ? level / 100.0 : level / 10.0 + levelDec
 * / 100.0`.
 */
export const normalizeLevel = (level: string | number | undefined | null, levelDec = 0): number => {
	const parsed = typeof level === 'string' ? parseFloat(level) : (level ?? 0);
	const n = Number.isFinite(parsed) ? parsed : 0;
	if (!Number.isInteger(n)) return n;
	return n >= 100 ? n / 100 : n / 10 + levelDec / 100;
};

/**
 * Decode a single raw `dtx_files.level` to its two-decimal display string.
 * Uses `normalizeLevel` (levelDec = 0 for the cloud single-column case).
 */
export const formatLevel = (level: string | number | undefined | null): string => {
	return normalizeLevel(level).toFixed(2);
};
