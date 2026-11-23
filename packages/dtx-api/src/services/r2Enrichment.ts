import {
	decodeArrayBufferWithBomDetection,
	parseSetDef,
	normalizeSetDefFileName
} from '@dtx/common/encoding';
import { normalizeLevel } from '@dtx/common';
import type { WorkerLogger } from '../lib/workerLogger';
import type { R2Bucket } from '@cloudflare/workers-types';
import {
	FULL_TRACK_AUDIO_EXTENSIONS,
	isPreviewKey,
	isPreviewMp3Key,
	isTopLevelNamedR2Key,
	isTopLevelR2Key,
	listAllR2Objects,
	listR2ObjectPages,
	r2FileName,
	selectTopLevelFullTrackObject,
	toPublicR2Url,
	type R2ObjectMeta
} from '../lib/r2Files';
import { isCanonicalBgmDerivativeKey } from './bgmM4a';

export type R2FileEntry = {
	key: string;
	size: number;
	uploaded: string;
};

export type CatalogDtxFileInput = {
	label: string;
	level: number;
};

/**
 * Catalog chart file with the fileUrl/fileSizeBytes coupling invariant
 * expressed in the type: both fields are either set (R2 object present)
 * or null (R2 object missing). fileEncoding is always set because the
 * parser treats absence as SHIFT_JIS.
 */
export type CatalogChartFilePresent = CatalogDtxFileInput & {
	fileUrl: string;
	fileSizeBytes: number;
	fileEncoding: 'SHIFT_JIS';
};

export type CatalogChartFileMissing = CatalogDtxFileInput & {
	fileUrl: null;
	fileSizeBytes: null;
	fileEncoding: 'SHIFT_JIS';
};

export type CatalogChartFile = CatalogChartFilePresent | CatalogChartFileMissing;

export type CatalogFileDiscovery = {
	previewUrl: string | null;
	downloadUrl: string | null;
	charts: CatalogChartFile[];
	/**
	 * False when the caller passed an empty `dtxFiles` array (URL-only
	 * discovery), meaning `charts` is empty because chart matching was
	 * intentionally skipped — not because no .dtx files exist in R2.
	 * Chart resolvers check this flag to detect stale URL-only cache
	 * entries and trigger a full re-discovery on demand.
	 */
	chartsPopulated: boolean;
};

export type CatalogDiscoveryOptions = {
	simfileId: number;
	dtxFiles: CatalogDtxFileInput[];
	publicBaseUrl: string;
};

/**
 * Maximum number of concurrent R2 list calls when batch-enriching
 * hasUploadedFiles for a list of simfiles. Matches the cap used in the
 * dtx-web REST endpoint (MAX_CONCURRENT_R2_CHECKS = 4).
 */
const MAX_CONCURRENT_R2_LIST = 4;

/**
 * Only the chart header is probed for #DLEVEL, so same-label pairing
 * downloads the head of each candidate instead of the whole body —
 * preview-only resolutions otherwise pay full chart downloads for
 * rows they never serve. A #DLEVEL beyond the window leaves the ref
 * unprobed, which the claim loop already tolerates.
 */
const CHART_LEVEL_PROBE_BYTES = 16 * 1024;

/**
 * The ambiguous root stem-claim reads deeper than the pairing window —
 * a #DLEVEL behind a long #WAV/comment header is still a valid rating —
 * but stays bounded: uploads allow 50 MiB per file and batches run four
 * deep, so an unbounded read could buffer hundreds of MiB into one
 * isolate. A miss past this window reports unprobed, not unrated.
 */
const CHART_LEVEL_DEEP_PROBE_BYTES = 1024 * 1024;

type SetDefFileRef = {
	file: string;
	/**
	 * True when the raw #LxFILE value carried an explicit `./` or `.\`
	 * current-directory prefix. Normalization strips that prefix, so
	 * without this marker `./42/basic.dtx` becomes indistinguishable
	 * from the already-prefixed bucket key `42/basic.dtx` — yet the two
	 * resolve differently when the first path segment equals the
	 * simfile id (`42/` + `42/basic.dtx` = `42/42/basic.dtx`).
	 */
	explicitlyRelative: boolean;
};

const parseSetDefFilesByLabel = (setDefText: string): Map<string, SetDefFileRef[]> => {
	// A single label can legitimately appear on multiple L-slots (e.g. two
	// charts both labelled "BASIC"). Collecting an array per label — rather
	// than a single value keyed by label alone — preserves every distinct
	// file so the consumer can assign one file per matching DB row instead
	// of overwriting earlier entries and silently collapsing two rows onto
	// the same R2 object. parseSetDef returns slots sorted by numeric level,
	// so each array stays in L-slot order (L1 before L2 …) regardless of the
	// line order inside set.def.
	const filesByLabel = new Map<string, SetDefFileRef[]>();
	for (const { label, fileName } of parseSetDef(setDefText).levels) {
		// Store the normalized filename plus the explicit-relative marker.
		// Path resolution is deferred to the caller (discoverCatalogFiles),
		// which has access to the R2 object map and can try the set.def's
		// directory first with a simfile-root fallback. This matches
		// the DTX convention — confirmed by the desktop parser at
		// packages/dtx-desktop/src-tauri/src/songs.rs (read_set_def_labels),
		// which reads set.def and .dtx files from the SAME folder — that
		// #LxFILE references are relative to the set.def's directory, not
		// the simfile root.
		const ref: SetDefFileRef = {
			file: normalizeSetDefFileName(fileName),
			explicitlyRelative: /^\.[\\/]/.test(fileName)
		};
		// A directory-only reference (`#L1FILE ./`, `.\`, `.`) normalizes to
		// no usable filename — it can never match an R2 object. Skipping it
		// keeps the row unclaimed so the sorted-key fallback can still bind
		// a real chart instead of being suppressed by a claim that cannot
		// resolve.
		if (!ref.file || /^[./]+$/.test(ref.file)) continue;
		const key = label.toLowerCase();
		const list = filesByLabel.get(key);
		if (list) {
			list.push(ref);
		} else {
			filesByLabel.set(key, [ref]);
		}
	}
	return filesByLabel;
};

/**
 * Extract a chart file's raw #DLEVEL value. Mirrors the desktop uploader's
 * `directive_value('#DLEVEL')` + `parse_number` in
 * packages/dtx-desktop/src-tauri/src/songs.rs — the same parse that produced
 * each row's stored level: leading whitespace allowed, directive name
 * case-insensitive and ending at a `:` or whitespace separator, and the
 * value keeps fractions (`4.5`). parse_dtx_metadata keeps scanning until a
 * directive parses — a blank or malformed #DLEVEL leaves the level unset
 * rather than shadowing a later valid one — so the first PARSEABLE
 * directive wins, not the first directive. Returns undefined when no
 * directive parses so the caller can keep slot order for unreadable charts.
 */
const extractChartRawLevel = (text: string): number | undefined => {
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trimStart();
		if (!/^#DLEVEL[\s:]/i.test(trimmed)) continue;
		// The separator is a single character — ':' or one whitespace —
		// so the value always starts at directive length + 1.
		const token = trimmed
			.slice('#DLEVEL'.length + 1)
			.trimStart()
			.match(/^[0-9.+-]*/)?.[0];
		const raw = token ? Number(token) : NaN;
		if (!Number.isNaN(raw)) return raw;
	}
	return undefined;
};

/**
 * Download a chart's head window and return its #DLEVEL on the normalized
 * scale. Returns null when the whole object was read but carries no
 * parseable #DLEVEL — parse_dtx_folder catalogs only non-zero-rated
 * charts, so such a file can never be a row's source, the same as an
 * explicit `#DLEVEL 0` (which returns 0). Returns undefined when the
 * object cannot be fetched OR the window cut the file short — a
 * truncated window cannot prove "no #DLEVEL anywhere", so a miss there
 * is unprobed rather than unrated.
 */
const probeChartHeaderLevel = async (
	bucket: R2Bucket,
	key: string,
	logger: WorkerLogger,
	maxBytes: number = CHART_LEVEL_PROBE_BYTES
): Promise<number | null | undefined> => {
	try {
		// Request one byte past the window: a short reply means EOF was
		// reached and the scan was complete, while a full reply proves
		// the file continues and a miss is only "unprobed".
		const body = await bucket.get(key, {
			range: { offset: 0, length: maxBytes + 1 }
		});
		if (!body) return undefined;
		const buffer = await body.arrayBuffer();
		const truncated = buffer.byteLength > maxBytes;
		let head = decodeArrayBufferWithBomDetection(buffer);
		// NUL characters in the decoded header mean the bytes are an
		// encoding the decoder could not place — undecodable, not unrated.
		// Reporting unprobed keeps the caller from reserving the object as
		// a proven rating-less chart (or pairing it positionally off a
		// rating nobody read).
		if (head.includes('\u0000')) return undefined;
		if (truncated) {
			// A full window means the file may continue past it —
			// the last line can be cut mid-value (`#DLEVEL: 45` of a
			// truncated `455` reads as level 4.50, not 4.55). Drop
			// the partial line instead of trusting a truncated header.
			head = head.slice(0, head.lastIndexOf('\n') + 1);
		}
		const rawLevel = extractChartRawLevel(head);
		if (rawLevel === undefined) return truncated ? undefined : null;
		return normalizeLevel(rawLevel);
	} catch (err) {
		logger.warn('chart header level probe failed; treating chart as unprobed', {
			key,
			error: err instanceof Error ? err.message : String(err)
		});
		return undefined;
	}
};

const readSetDefFilesByLabel = async (
	bucket: R2Bucket,
	setDefKey: string | undefined,
	logger: WorkerLogger
): Promise<Map<string, SetDefFileRef[]>> => {
	if (!setDefKey) return new Map();

	try {
		const object = await bucket.get(setDefKey);
		if (!object) return new Map();
		// Decode with BOM detection: set.def files in this app are routinely
		// written as UTF-16LE with BOM (see write_utf16le_with_bom in
		// packages/dtx-desktop/src-tauri/src/songs.rs) or UTF-8 with BOM.
		// The default R2 text() path decodes as UTF-8 and
		// would either garble UTF-16LE content or leave a BOM on the first
		// directive, making it unparseable and silently falling back to
		// sorted-key pairing.
		const setDefText = decodeArrayBufferWithBomDetection(await object.arrayBuffer());
		return parseSetDefFilesByLabel(setDefText);
	} catch (err) {
		// Transient R2 errors or unexpected body issues: fall through
		// to the deterministic sorted-key fallback instead of failing
		// the entire catalog discovery. Logged (not rethrown) because
		// the fallback is the intended graceful-degradation path.
		logger.warn('set.def read failed; falling back to sorted-key matching', {
			setDefKey,
			error: err instanceof Error ? err.message : String(err)
		});
		return new Map();
	}
};

export const discoverCatalogFiles = async (
	bucket: R2Bucket,
	{ simfileId, dtxFiles, publicBaseUrl }: CatalogDiscoveryOptions,
	logger: WorkerLogger
): Promise<CatalogFileDiscovery> => {
	const prefix = `${simfileId}/`;
	const objects = (await listAllR2Objects(bucket, prefix)).filter(
		(obj: R2ObjectMeta) => obj.key.length > prefix.length
	);
	const objectsByKey = new Map(objects.map((obj: R2ObjectMeta) => [obj.key, obj]));
	// Case-insensitive fallback map: SET.DEF file references may use a
	// different case than the actual R2 object key (e.g. SET.DEF says
	// BASIC.DTX while R2 stores 42/basic.dtx). Uploads from case-
	// insensitive filesystems (Windows, default macOS) routinely produce
	// this mismatch. The desktop parseDtxFiles path lowercases both sides
	// of the comparison; we mirror that here as a fallback after exact
	// match to avoid marking valid charts as missing.
	const objectsByKeyLower = new Map(
		objects.map((obj: R2ObjectMeta) => [obj.key.toLowerCase(), obj])
	);

	// Preview selection: prefer the canonical top-level key
	// `{simfileId}/preview.mp3` (case-insensitive) over any nested
	// `preview.mp3` (e.g. `42/assets/preview.mp3`). DTX simfiles routinely
	// ship packaged sample chips under `assets/` and the public preview
	// contract is the top-level path — selecting by basename alone plus
	// alphabetic sort would return the nested asset first because
	// `42/assets/preview.mp3` sorts before `42/preview.mp3`.
	const previewObject =
		objects.find((obj: R2ObjectMeta) => isTopLevelNamedR2Key(obj.key, prefix, 'preview.mp3')) ??
		objects.find((obj: R2ObjectMeta) => isPreviewMp3Key(obj.key));
	const previewUrl = previewObject ? toPublicR2Url(publicBaseUrl, previewObject.key) : null;

	const isAudio = (key: string): boolean => {
		const lower = key.toLowerCase();
		return (
			FULL_TRACK_AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension)) &&
			!isPreviewMp3Key(key)
		);
	};
	// A top-level audio file lives directly under the simfile prefix
	// (e.g. 42/song.ogg) rather than in a subdirectory (e.g.
	// 42/assets/kick.ogg). DTX simfiles ship individual drum sample
	// chips under assets/, which are not full-audio files. When
	// selecting a downloadUrl fallback we must prefer the top-level
	// full-audio candidate over nested samples, otherwise lexicographic
	// sort would return the sample chip first because
	// '42/assets/...' sorts before '42/song.ogg' — mirroring the
	// canonical-vs-nested preference used for preview.mp3 and set.def.
	// Top-level must win over extension: a top-level .mp3 backing track
	// is the full-audio download candidate even when nested .ogg sample
	// chips exist, because .ogg has higher extension priority. Checking
	// extension first would sort the nested sample ahead of the backing
	// track and point downloadUrl at a drum chip instead of full audio.
	const topLevelDownloadObject = selectTopLevelFullTrackObject(objects, prefix, (object) =>
		isCanonicalBgmDerivativeKey(object.key, simfileId)
	);
	const nestedAudioObjects = objects
		.filter((obj: R2ObjectMeta) => !isTopLevelR2Key(obj.key, prefix) && isAudio(obj.key))
		.sort((a, b) => {
			const aExt = FULL_TRACK_AUDIO_EXTENSIONS.findIndex((extension) =>
				a.key.toLowerCase().endsWith(extension)
			);
			const bExt = FULL_TRACK_AUDIO_EXTENSIONS.findIndex((extension) =>
				b.key.toLowerCase().endsWith(extension)
			);
			if (aExt !== bExt) return aExt - bExt;
			return a.key.localeCompare(b.key);
		});
	const downloadObject = topLevelDownloadObject ?? nestedAudioObjects[0];
	const downloadUrl = downloadObject ? toPublicR2Url(publicBaseUrl, downloadObject.key) : null;

	const dtxObjects = objects
		.filter((obj: R2ObjectMeta) => obj.key.toLowerCase().endsWith('.dtx'))
		.sort((a: R2ObjectMeta, b: R2ObjectMeta) => a.key.localeCompare(b.key));
	const dtxObjectKeys = dtxObjects.map((obj: R2ObjectMeta) => obj.key);
	const usedDtxKeys = new Set<string>();

	// Prefer the canonical top-level key `{simfileId}/set.def`
	// (case-insensitive) over any nested `set.def` (e.g.
	// `42/assets/set.def`). DTX simfiles routinely ship packaged
	// sample chips and other assets under `assets/`, and basename-only
	// matching would pick the nested copy first because
	// `42/assets/set.def` sorts before `42/set.def` — causing chart
	// labels to be read from the wrong/empty SET.DEF and `fileUrl`
	// pairing to fall back to incorrect sorted-key matching.
	const setDefKey =
		objects.find((obj: R2ObjectMeta) => isTopLevelNamedR2Key(obj.key, prefix, 'set.def'))
			?.key ??
		objects.find((obj: R2ObjectMeta) => r2FileName(obj.key).toLowerCase() === 'set.def')?.key;
	// Skip fetching set.def when no chart rows need matching — preview-only
	// requests never read filesByLabel, so we avoid an unnecessary R2 GET.
	const filesByLabel =
		dtxFiles.length > 0
			? await readSetDefFilesByLabel(bucket, setDefKey, logger)
			: new Map<string, SetDefFileRef[]>();
	// Derive the directory that contains the selected set.def so relative
	// #LxFILE references resolve against it (e.g. 42/song/basic.dtx when
	// set.def is 42/song/set.def) instead of always the simfile root.
	// Uploads preserve directory structure, so sibling chart files live
	// next to the set.def. Falls back to the simfile root when set.def is
	// at the top level or not found.
	const setDefBaseDir = setDefKey
		? setDefKey.slice(0, setDefKey.lastIndexOf('/') + 1) || prefix
		: prefix;

	const matchedKeysByRowIndex = new Map<number, string>();
	// Rows with an explicit set.def label→file mapping are "claimed" by
	// set.def regardless of whether the referenced R2 object exists. This
	// prevents the sorted-key fallback from assigning an unrelated .dtx
	// key to a chart whose intended file is missing — which would silently
	// serve the wrong chart instead of the correct missing-chart null.
	const rowsClaimedBySetDef = new Set<number>();
	// Resolve a SET.def file reference to an R2 object. Absolute paths
	// (already include the simfile id) are kept as-is; relative names are
	// resolved against the set.def's directory first, then the simfile
	// root prefix as a fallback for legacy flat uploads where chart files
	// live at the root despite a nested set.def. An explicit `./`/`.\`
	// prefix forces the relative branch even when the normalized name
	// collides with the id prefix — `./42/basic.dtx` means
	// `42/42/basic.dtx`, not `42/basic.dtx`. Exact match first; fall back
	// to a case-insensitive lookup so that SET.DEF references like
	// BASIC.DTX still resolve when the R2 key is basic.dtx. Without these
	// fallbacks the row is marked as claimed-but-missing, which surfaces
	// as an INTERNAL error via requireCatalogChart even though the chart
	// object exists.
	const resolveSetDefObject = (setDefRef: SetDefFileRef): R2ObjectMeta | undefined => {
		const candidates =
			!setDefRef.explicitlyRelative && setDefRef.file.startsWith(prefix)
				? [setDefRef.file]
				: setDefBaseDir === prefix
					? [`${prefix}${setDefRef.file}`]
					: [`${setDefBaseDir}${setDefRef.file}`, `${prefix}${setDefRef.file}`];
		for (const candidateKey of candidates) {
			const matchedObject =
				objectsByKey.get(candidateKey) ?? objectsByKeyLower.get(candidateKey.toLowerCase());
			if (matchedObject) return matchedObject;
		}
		return undefined;
	};

	// A repeated label yields multiple candidate files, but nothing
	// enforces ascending #DLEVEL across L-slots — slot order is not a
	// difficulty signal. Each row's level IS its own chart's #DLEVEL, so
	// probe the referenced charts' headers and match rows to files on the
	// same normalized scale. Files that can't be resolved, fetched, or
	// parsed carry no probed level — the claim loop treats them as
	// possible matches only after exact-level matches fail.
	const rowCountByLabel = new Map<string, number>();
	const rowLevelsByLabel = new Map<string, Set<number>>();
	for (const file of dtxFiles) {
		const label = file.label.toLowerCase();
		rowCountByLabel.set(label, (rowCountByLabel.get(label) ?? 0) + 1);
		let levels = rowLevelsByLabel.get(label);
		if (!levels) rowLevelsByLabel.set(label, (levels = new Set()));
		levels.add(normalizeLevel(file.level));
	}
	// A one-row/one-ref label is deterministic only when SET.def names
	// every .dtx object in the folder. When an unlisted chart exists, the
	// single ref can be an unrated placeholder (#DLEVEL 0) that
	// parse_dtx_folder skipped while cataloging the unlisted file under
	// this label — claiming it unprobed would bind the placeholder and
	// suppress the fallback that holds the row's real chart.
	const referencedKeys = new Set<string>();
	for (const refs of filesByLabel.values()) {
		for (const ref of refs) {
			const object = resolveSetDefObject(ref);
			if (object) referencedKeys.add(object.key);
		}
	}
	const hasUnlistedChart = dtxObjects.some((obj) => !referencedKeys.has(obj.key));
	const fileLevelByRef = new Map<SetDefFileRef, number>();
	const levelProbes: Promise<void>[] = [];
	for (const [label, refs] of filesByLabel) {
		const rows = rowCountByLabel.get(label) ?? 0;
		// Probe only ambiguous groups: one row claiming its label's single
		// reference is already deterministic. Ambiguity needs either side
		// to multiply — multiple refs, or multiple rows sharing one
		// remaining ref (e.g. a directory placeholder removed the other) —
		// or an unlisted chart the named ref could wrongly displace.
		if (rows === 0 || (rows === 1 && refs.length === 1 && !hasUnlistedChart)) continue;
		for (const ref of refs) {
			const object = resolveSetDefObject(ref);
			if (!object) continue;
			levelProbes.push(
				(async () => {
					const level = await probeChartHeaderLevel(bucket, object.key, logger);
					// A complete read with no #DLEVEL (null) proves the chart is
					// unrated — record it as 0 so the claim loop disqualifies it
					// the same as an explicit `#DLEVEL 0`. Only an unprobed
					// result (undefined) stays out of the map.
					if (level !== undefined) {
						fileLevelByRef.set(ref, level ?? 0);
					}
				})()
			);
		}
	}
	await Promise.all(levelProbes);

	// Consume one SET.def file per matching row so that duplicate labels
	// each claim a distinct R2 object instead of all collapsing onto the
	// last-inserted entry. Rows arrive in id (insertion) order — the
	// uploader's filename order, not slot order — so they claim in
	// ascending normalized level (rows store the raw #DLEVEL value, whose
	// encoding differs above and below 100 — normalize before comparing
	// or 450 (4.50) outranks 60 (6.00)); index order breaks ties for the
	// genuinely ambiguous equal-level case. Each row prefers the file
	// whose probed #DLEVEL equals its own — identical metadata means that
	// file IS the row's chart. Failing that it takes the first ref it
	// could still own: a probed level disqualifies only when it equals a
	// DIFFERENT row's level in this label — provably that row's chart —
	// while a header matching no row just disagrees with the upload
	// metadata and SET.def still names the file for the slot.
	const claimOrder = dtxFiles
		.map((file, index) => ({ file, index }))
		.sort(
			(a, b) =>
				normalizeLevel(a.file.level) - normalizeLevel(b.file.level) || a.index - b.index
		);
	for (const { file, index } of claimOrder) {
		const label = file.label.toLowerCase();
		const refs = filesByLabel.get(label);
		if (!refs?.length) continue;
		const rowLevel = normalizeLevel(file.level);
		let refIndex = refs.findIndex((ref) => fileLevelByRef.get(ref) === rowLevel);
		if (refIndex === -1) {
			refIndex = refs.findIndex((ref) => {
				const probed = fileLevelByRef.get(ref);
				if (probed === undefined) return true;
				// A probed level of zero names a chart the uploader never
				// catalogued — parse_dtx_folder skips unrated charts
				// (#DLEVEL 0 or absent) — so no row can own it. Left in
				// refs it stays reserved; a non-exact claim must not let
				// it displace an unlisted file that is a row's real chart.
				if (probed === 0) return false;
				const levels = rowLevelsByLabel.get(label);
				for (const level of levels ?? []) {
					if (level === probed && level !== rowLevel) return false;
				}
				return true;
			});
			// Every remaining ref is provably another row's chart — leave
			// them for their true rows and let this row fall through to
			// the sorted fallback.
			if (refIndex === -1) continue;
		}
		rowsClaimedBySetDef.add(index);
		const [setDefRef] = refs.splice(refIndex, 1);
		const matchedObject = resolveSetDefObject(setDefRef);
		if (matchedObject) {
			matchedKeysByRowIndex.set(index, matchedObject.key);
			usedDtxKeys.add(matchedObject.key);
		}
	}
	// Unclaimed refs (surplus files, or provably another row's chart that
	// was never claimed) still name charts under a set.def label —
	// reserve their objects so the sorted fallback cannot bind them to
	// an unrelated row. One exception: a leftover object can be an
	// unclaimed row's own file. The desktop keys its SET.def label lookup
	// by the raw #LxFILE value, so a `./` or subdirectory prefix misses
	// and the row stores the filename stem instead (fallback_level_label:
	// SOLO for solo.dtx). A unique unclaimed row whose label equals the
	// resolved file's stem takes the object; ambiguity keeps the file
	// reserved. The stem claim is limited to objects directly at the
	// simfile root or beside the selected set.def — a deeper nested file
	// sharing the basename (extras/solo.dtx next to solo.dtx) is never a
	// row's chart — and is skipped when the probed #DLEVEL is zero, since
	// unrated charts never produce rows. When the resolved object sits
	// beside a nested set.def but an unused root chart carries the same
	// stem, the root file wins the row: stem labels catalog the
	// uploader's song-folder file, not a stray copy that merely borrowed
	// the leftover ref's filename. That preference holds only when the
	// root copy probes as a rated chart — an unrated (#DLEVEL 0 or
	// absent) same-stem file can never be a row's source, so it must not
	// displace the set.def sibling.
	for (const refs of filesByLabel.values()) {
		for (const ref of refs) {
			const object = resolveSetDefObject(ref);
			if (!object) continue;
			if (
				(isTopLevelR2Key(object.key, prefix) ||
					isTopLevelR2Key(object.key, setDefBaseDir)) &&
				fileLevelByRef.get(ref) !== 0
			) {
				const stem = r2FileName(object.key)
					.replace(/\.dtx$/i, '')
					.toLowerCase();
				const stemRowIndexes: number[] = [];
				dtxFiles.forEach((file, index) => {
					if (!rowsClaimedBySetDef.has(index) && file.label.toLowerCase() === stem) {
						stemRowIndexes.push(index);
					}
				});
				if (stemRowIndexes.length === 1) {
					let claimObject = object;
					if (!isTopLevelR2Key(object.key, prefix)) {
						const rootCandidate = dtxObjects.find(
							(candidate) =>
								isTopLevelR2Key(candidate.key, prefix) &&
								!usedDtxKeys.has(candidate.key) &&
								r2FileName(candidate.key)
									.replace(/\.dtx$/i, '')
									.toLowerCase() === stem
						);
						if (rootCandidate) {
							// Read deeper than the pairing window: a
							// #DLEVEL behind a long header is still a
							// valid rating. A file outgrowing the window
							// reports unprobed — nothing is proven — so
							// the sibling keeps the row.
							const rootLevel = await probeChartHeaderLevel(
								bucket,
								rootCandidate.key,
								logger,
								CHART_LEVEL_DEEP_PROBE_BYTES
							);
							if (typeof rootLevel === 'number' && rootLevel !== 0) {
								claimObject = rootCandidate;
							} else {
								// Unrated (explicit #DLEVEL 0 or a
								// complete-read miss) or unprobed: the
								// sibling keeps the row either way, but
								// the candidate must not stay in the
								// sorted fallback — it is provably no
								// row's chart or possibly THIS row's,
								// and a positional match could bind it
								// to an unrelated difficulty instead.
								usedDtxKeys.add(rootCandidate.key);
							}
						}
					}
					rowsClaimedBySetDef.add(stemRowIndexes[0]);
					matchedKeysByRowIndex.set(stemRowIndexes[0], claimObject.key);
					usedDtxKeys.add(claimObject.key);
				}
			}
			usedDtxKeys.add(object.key);
		}
	}

	// Bind still-unclaimed rows to a unique unused chart whose filename
	// stem equals the row label — parse_dtx_folder catalogs unlisted
	// charts under their stem, so a one-to-one stem match is likely the
	// row's own file, not a positional guess. Likely, not provably: the
	// stem match claims the row only when the candidate's probed #DLEVEL
	// equals the row's level on the normalized scale — the same identity
	// check the set.def claim loop applies to named refs. A confirmed
	// unrated candidate (explicit #DLEVEL 0 or a complete-read miss)
	// never produced a row, so it is reserved rather than left for the
	// positional fallback to bind to an unrelated row. The same
	// root-or-set.def-sibling scope as the leftover-ref stem claim
	// applies: deeper nested files are never a row's chart. Stems or
	// labels shared by more than one candidate stay ambiguous and fall
	// through to the sorted fallback, whose level/filename pairing can
	// otherwise swap difficulties when the two orders disagree.
	const unusedKeysByStem = new Map<string, string[]>();
	for (const key of dtxObjectKeys) {
		if (usedDtxKeys.has(key)) continue;
		if (!isTopLevelR2Key(key, prefix) && !isTopLevelR2Key(key, setDefBaseDir)) continue;
		const stem = r2FileName(key)
			.replace(/\.dtx$/i, '')
			.toLowerCase();
		const keys = unusedKeysByStem.get(stem);
		if (keys) keys.push(key);
		else unusedKeysByStem.set(stem, [key]);
	}
	const unclaimedRowsByLabel = new Map<string, number[]>();
	dtxFiles.forEach((file, index) => {
		if (rowsClaimedBySetDef.has(index)) return;
		const label = file.label.toLowerCase();
		const rows = unclaimedRowsByLabel.get(label);
		if (rows) rows.push(index);
		else unclaimedRowsByLabel.set(label, [index]);
	});
	for (const [stem, keys] of unusedKeysByStem) {
		const rows = unclaimedRowsByLabel.get(stem);
		if (keys.length !== 1 || rows?.length !== 1) continue;
		// Read deeper than the pairing window like the root stem-claim
		// path — a #DLEVEL behind a long header is still a valid rating.
		const probed = await probeChartHeaderLevel(
			bucket,
			keys[0],
			logger,
			CHART_LEVEL_DEEP_PROBE_BYTES
		);
		const rowLevel = normalizeLevel(dtxFiles[rows[0]].level);
		if (rowLevel !== 0 && probed === rowLevel) {
			rowsClaimedBySetDef.add(rows[0]);
			matchedKeysByRowIndex.set(rows[0], keys[0]);
			usedDtxKeys.add(keys[0]);
		} else if (probed === 0 || probed === null) {
			usedDtxKeys.add(keys[0]);
		}
		// An unprobed read or a rating that names a different chart proves
		// nothing either way — leave the row and the key to the fallback.
	}

	// Content-verify the remaining charts before pairing positionally:
	// filename order is not a difficulty signal (numbered exports like
	// 01.dtx/02.dtx can rate 6.00 then 4.50 on the normalized scale), so
	// pairing sorted rows with sorted keys swaps charts whenever the two
	// orders disagree. Probe each remaining object's #DLEVEL like the
	// set.def claim loop does: each row takes the first unused key whose
	// probed level equals its own — identical metadata means that file
	// IS the row's chart. A proven-unrated object (explicit #DLEVEL 0 or
	// a complete-read miss) is reserved — parse_dtx_folder never
	// cataloged it. A probed key still unused after exact matching only
	// disagrees with the upload metadata — like the set.def claim loop,
	// a level disqualifies a file only when it names a DIFFERENT row's
	// chart — so it stays positional rather than being reserved.
	// Unprobed keys stay positional too.
	const fallbackRows = dtxFiles
		.map((file, index) => ({ file, index }))
		.filter(({ index }) => !rowsClaimedBySetDef.has(index))
		.sort(
			(a, b) =>
				normalizeLevel(a.file.level) - normalizeLevel(b.file.level) || a.index - b.index
		);
	const probedLevelByKey = new Map<string, number>();
	if (fallbackRows.length > 0) {
		await Promise.all(
			dtxObjectKeys.map(async (key) => {
				if (usedDtxKeys.has(key)) return;
				const level = await probeChartHeaderLevel(bucket, key, logger);
				if (level === undefined) return;
				if (level === null || level === 0) {
					usedDtxKeys.add(key);
					return;
				}
				probedLevelByKey.set(key, level);
			})
		);
		for (const row of fallbackRows) {
			const rowLevel = normalizeLevel(row.file.level);
			const key = dtxObjectKeys.find(
				(candidate) =>
					!usedDtxKeys.has(candidate) && probedLevelByKey.get(candidate) === rowLevel
			);
			if (!key) continue;
			rowsClaimedBySetDef.add(row.index);
			matchedKeysByRowIndex.set(row.index, key);
			usedDtxKeys.add(key);
		}
	}

	// What remains is genuinely positional: rows arrive in id order —
	// the uploader's filename order (parse_dtx_folder emits rows in
	// files.sort() order) — so pair remaining rows in row order with
	// remaining keys in key order, reproducing the uploader's own
	// row↔file correspondence instead of assuming filenames sort by
	// difficulty.
	const positionalRows = fallbackRows
		.filter(({ index }) => !rowsClaimedBySetDef.has(index))
		.sort((a, b) => a.index - b.index);
	const fallbackKeys = dtxObjectKeys.filter((key) => !usedDtxKeys.has(key));
	for (const [fallbackIndex, row] of positionalRows.entries()) {
		const key = fallbackKeys[fallbackIndex];
		if (key) {
			matchedKeysByRowIndex.set(row.index, key);
		}
	}

	const charts = dtxFiles.map((file, index): CatalogChartFile => {
		const key = matchedKeysByRowIndex.get(index);
		const object = key ? objectsByKey.get(key) : undefined;
		if (!object) {
			return { ...file, fileUrl: null, fileSizeBytes: null, fileEncoding: 'SHIFT_JIS' };
		}
		return {
			...file,
			fileUrl: toPublicR2Url(publicBaseUrl, object.key),
			fileSizeBytes: object.size,
			fileEncoding: 'SHIFT_JIS'
		};
	});

	return { previewUrl, downloadUrl, charts, chartsPopulated: dtxFiles.length > 0 };
};

export const batchDiscoverCatalogFiles = async (
	bucket: R2Bucket,
	options: CatalogDiscoveryOptions[],
	logger: WorkerLogger
): Promise<Map<number, CatalogFileDiscovery>> => {
	const results = new Map<number, CatalogFileDiscovery>();
	if (options.length === 0) return results;

	let nextIndex = 0;
	const worker: () => Promise<void> = async () => {
		while (nextIndex < options.length) {
			const option = options[nextIndex++];
			results.set(option.simfileId, await discoverCatalogFiles(bucket, option, logger));
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_R2_LIST, options.length) }, () => worker())
	);
	return results;
};

export const enrichFiles = async (bucket: R2Bucket, simfileId: number): Promise<R2FileEntry[]> => {
	const prefix = `${simfileId}/`;
	const objects = await listAllR2Objects(bucket, prefix);
	return objects
		.filter((obj: R2ObjectMeta) => obj.key.length > prefix.length)
		.map((obj: R2ObjectMeta) => ({
			key: obj.key,
			size: obj.size,
			uploaded:
				obj.uploaded instanceof Date ? obj.uploaded.toISOString() : String(obj.uploaded)
		}));
};

/**
 * Batch-enrich `files` for multiple simfiles with bounded concurrency.
 * Returns a Map of simfileId → R2FileEntry[].
 *
 * Mirrors batchEnrichHasUploadedFiles to avoid unbounded R2 fan-out
 * when GraphQL resolves `files` for a list of simfiles.
 */
export const batchEnrichFiles = async (
	bucket: R2Bucket,
	simfileIds: number[]
): Promise<Map<number, R2FileEntry[]>> => {
	const results = new Map<number, R2FileEntry[]>();
	if (simfileIds.length === 0) return results;

	let nextIndex = 0;
	const worker: () => Promise<void> = async () => {
		while (nextIndex < simfileIds.length) {
			const idx = nextIndex++;
			const id = simfileIds[idx];
			results.set(id, await enrichFiles(bucket, id));
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_R2_LIST, simfileIds.length) }, () => worker())
	);
	return results;
};

export const enrichHasUploadedFiles = async (
	bucket: R2Bucket,
	simfileId: number
): Promise<boolean> => {
	const prefix = `${simfileId}/`;
	for await (const page of listR2ObjectPages(bucket, prefix)) {
		if (page.some((obj) => obj.key.length > prefix.length && !isPreviewKey(obj.key))) {
			return true;
		}
	}
	return false;
};

/**
 * Batch-enrich `hasUploadedFiles` for multiple simfiles with bounded
 * concurrency. Returns a Map of simfileId → boolean.
 *
 * This should be used by GraphQL resolvers that resolve `hasUploadedFiles`
 * for a list of simfiles, to avoid unbounded R2 list fan-out.
 */
export const batchEnrichHasUploadedFiles = async (
	bucket: R2Bucket,
	simfileIds: number[]
): Promise<Map<number, boolean>> => {
	const results = new Map<number, boolean>();
	if (simfileIds.length === 0) return results;

	let nextIndex = 0;
	const worker: () => Promise<void> = async () => {
		while (nextIndex < simfileIds.length) {
			const idx = nextIndex++;
			const id = simfileIds[idx];
			results.set(id, await enrichHasUploadedFiles(bucket, id));
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_R2_LIST, simfileIds.length) }, () => worker())
	);
	return results;
};
