-- 0004_normalize_legacy_dtx_file_levels.sql
-- Before commit b2ccaaab, the desktop uploader stored the raw #DLEVEL value
-- (display scale, e.g. 5) directly into dtx_files.level instead of encoding it
-- to the ×10 storage contract (50 == 5.0). The matcher's normalizeCloudLevel
-- and the web formatLevel both decode an integer 1–9 on the ×100 scale
-- (5 → 0.05), so legacy charts fail auto-matching and the manual picker /
-- chart list display "0.05" for a real level-5 chart.
--
-- This migration multiplies legacy bare 1–9 integers by 100 so they land on
-- the ×100 scale (5 → 500 → 5.0). It is safe because:
--   - The only writer of dtx_files.level is createDtxFiles (called via
--     createSimfileWithDtx); the only caller that ever stored raw display-scale
--     values was the pre-b2ccaaab desktop renderer.
--   - DTX levels range 0.1–9.99. A bare 1–9 on the ×100 scale decodes to
--     0.01–0.09, which is below the minimum — so a bare 1–9 is unambiguously a
--     legacy display-scale value, not an intentional sub-0.1 level. This is
--     stronger than the previous ×10 reasoning (where 1–9 decoded to 0.1–0.9,
--     which overlapped the valid range).
--   - level = 0 (the column DEFAULT, and filtered out by the Rust parser) is
--     excluded by the BETWEEN 1 AND 9 guard.
--   - Levels ≥ 10 are already on the ×10 (or ×100) scale and are untouched.
--
-- Idempotent in the sense that after the first run no rows remain in 1–9, so a
-- re-run is a no-op. Forward-only: D1 migrations are not rolled back.
UPDATE dtx_files
   SET level = level * 100
 WHERE level BETWEEN 1 AND 9;
