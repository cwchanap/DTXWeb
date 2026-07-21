-- 0004_normalize_legacy_dtx_file_levels.sql
-- Before commit b2ccaaab, the desktop uploader stored the raw #DLEVEL value
-- (display scale, e.g. 5) directly into dtx_files.level instead of encoding it
-- to the ×10 storage contract (50 == 5.0). The matcher's normalizeCloudLevel
-- and the web formatLevel both decode an integer 1–9 as a sub-1.0 level
-- (5 → 0.5), so legacy charts fail auto-matching and the manual picker /
-- chart list display "0.50" for a real level-5 chart.
--
-- This migration multiplies legacy bare 1–9 integers by 10 so they decode
-- correctly on the ×10 scale (5 → 50 → 5.0). It is safe because:
--   - The only writer of dtx_files.level is createDtxFiles (called via
--     createSimfileWithDtx); the only caller that ever stored raw display-scale
--     values was the pre-b2ccaaab desktop renderer.
--   - Per the encoding contract, a bare 1–9 as an encoded value would mean a
--     sub-1.0 display level (0.1–0.9), which the codebase explicitly treats as
--     "unlikely in practice" and "more likely a data-entry error" (see the
--     normalizeCloudLevel comment in packages/dtx-desktop/src/renderer/src/lib/
--     scoreMatching.ts).
--   - level = 0 (the column DEFAULT, and filtered out by the Rust parser) is
--     excluded by the BETWEEN 1 AND 9 guard.
--   - Levels ≥ 10 are already on the ×10 (or ×100) scale and are untouched.
--
-- Idempotent in the sense that after the first run no rows remain in 1–9, so a
-- re-run is a no-op. Forward-only: D1 migrations are not rolled back.
UPDATE dtx_files
   SET level = level * 10
 WHERE level BETWEEN 1 AND 9;
