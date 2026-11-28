import {
	decodeArrayBufferWithBomDetection,
	parseSetDefDocumentLevels,
	normalizeSetDefFileName,
	normalizeLevel
} from '@dtx/common/encoding';
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

/**
 * Workers isolates commonly serve many requests. Cache definitive header
 * probes across those requests, keyed by the object's listing identity so an
 * overwrite cannot reuse a stale rating. Undefined results are not cached:
 * they include transient R2 failures as well as truncated probe windows.
 * The small FIFO bound keeps a large bucket corpus from growing isolate memory.
 */
const MAX_SHARED_CHART_LEVEL_PROBES = 512;
const sharedChartLevelProbeValues = new Map<string, number | null>();

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
	// the same R2 object. The slots are sorted by numeric level, so each
	// array stays in L-slot order (L1 before L2 …) regardless of the line
	// order inside set.def. The whole document is read, not just the first
	// #TITLE section: the desktop uploader's parse_set_def_labels folds every
	// section into one slot map, so rows exist for later sections' charts.
	const filesByLabel = new Map<string, SetDefFileRef[]>();
	for (const { label, fileName } of parseSetDefDocumentLevels(setDefText)) {
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
	maxBytes: number = CHART_LEVEL_PROBE_BYTES,
	expectedEtag?: string
): Promise<number | null | undefined> => {
	try {
		// Request one byte past the window: a short reply means EOF was
		// reached and the scan was complete, while a full reply proves
		// the file continues and a miss is only "unprobed". When the
		// listing supplied an etag, pin the read to that object version:
		// an overwrite between listing and GET must not cache the
		// replacement's rating under the old version's identity.
		const body = await bucket.get(key, {
			range: { offset: 0, length: maxBytes + 1 },
			...(expectedEtag ? { onlyIf: { etagMatches: expectedEtag } } : {})
		});
		if (!body) return undefined;
		// A failed R2 precondition returns metadata without a body. Comparing
		// the etag as well keeps nonstandard test adapters honest.
		if (expectedEtag && (!('body' in body) || body.etag !== expectedEtag)) return undefined;
		const buffer = await body.arrayBuffer();
		const truncated =
			typeof body.size === 'number'
				? buffer.byteLength < body.size
				: buffer.byteLength > maxBytes;
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

	// Sort chart keys in the uploader's filename order: read_top_level_files
	// uses Rust's case-sensitive path sort (songs.rs), which is what
	// produced the catalog rows' id order. Rust orders paths by UTF-8
	// bytes — code-point order — so compare code points, not UTF-16 code
	// units: a supplementary character's leading surrogate (0xD800–0xDBFF)
	// sorts below every BMP unit above it, inverting e.g. 'Ａ.dtx'
	// (U+FF21) against '𠀀.dtx' (U+20000). Locale collation does not
	// reproduce the order either: it places 'basic.dtx' before
	// 'Expert.dtx' while the uploader kept 'Expert.dtx' first, so pairing
	// the two orders swaps previews.
	const compareByCodePoint = (a: string, b: string): number => {
		const aPoints = Array.from(a, (ch) => ch.codePointAt(0) ?? 0);
		const bPoints = Array.from(b, (ch) => ch.codePointAt(0) ?? 0);
		for (let index = 0; index < Math.min(aPoints.length, bPoints.length); index++) {
			const diff = aPoints[index] - bPoints[index];
			if (diff !== 0) return diff;
		}
		return aPoints.length - bPoints.length;
	};
	const dtxObjects = objects
		.filter((obj: R2ObjectMeta) => obj.key.toLowerCase().endsWith('.dtx'))
		.sort((a: R2ObjectMeta, b: R2ObjectMeta) => compareByCodePoint(a.key, b.key));
	const dtxObjectKeys = dtxObjects.map((obj: R2ObjectMeta) => obj.key);
	const usedDtxKeys = new Set<string>();
	// Refs under different SET.def labels can resolve to one object (./a.dtx
	// and a.dtx, or a case-insensitive collide). A header read proves the
	// same rating for every ref, so share the in-flight probe rather than
	// fetching the same window once per label.
	const probeCache = new Map<string, Promise<number | null | undefined>>();
	const probeChartLevel = (
		key: string,
		maxBytes: number = CHART_LEVEL_PROBE_BYTES
	): Promise<number | null | undefined> => {
		const cacheKey = `${maxBytes}:${key}`;
		let probe = probeCache.get(cacheKey);
		if (!probe) {
			const object = objectsByKey.get(key);
			const uploaded =
				object?.uploaded instanceof Date
					? object.uploaded.toISOString()
					: String(object?.uploaded);
			const sharedKey = [
				maxBytes,
				key,
				object?.etag ?? '',
				object?.size ?? '',
				uploaded
			].join('|');
			if (object?.etag && sharedChartLevelProbeValues.has(sharedKey)) {
				probe = Promise.resolve(sharedChartLevelProbeValues.get(sharedKey));
			}
			if (!probe) {
				const readProbe = probeChartHeaderLevel(
					bucket,
					key,
					logger,
					maxBytes,
					object?.etag
				);
				if (!object?.etag) {
					probe = readProbe;
				} else {
					probe = readProbe.then((level) => {
						if (level !== undefined) {
							sharedChartLevelProbeValues.set(sharedKey, level);
							if (sharedChartLevelProbeValues.size > MAX_SHARED_CHART_LEVEL_PROBES) {
								const oldest = sharedChartLevelProbeValues.keys().next().value;
								if (oldest) sharedChartLevelProbeValues.delete(oldest);
							}
						}
						return level;
					});
				}
			}
			probeCache.set(cacheKey, probe);
		}
		return probe;
	};

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
	// Catalog-eligible charts sit directly at the simfile root or beside
	// the selected set.def — parse_dtx_folder catalogs only top-level
	// files, so a deeper-nested .dtx can never be a row's chart and must
	// not claim one by rating or take a positional slot while an
	// eligible candidate remains.
	const isCatalogEligibleKey = (key: string): boolean =>
		isTopLevelR2Key(key, prefix) || isTopLevelR2Key(key, setDefBaseDir);

	const matchedKeysByRowIndex = new Map<number, string>();
	// Rows with an explicit set.def label→file mapping are "claimed" by
	// set.def regardless of whether the referenced R2 object exists. This
	// prevents the sorted-key fallback from assigning an unrelated .dtx
	// key to a chart whose intended file is missing — which would silently
	// serve the wrong chart instead of the correct missing-chart null.
	const rowsClaimedBySetDef = new Set<number>();
	// Resolve a SET.def file reference to an R2 object. Absolute paths
	// (already include the simfile id) are tried as-is first; relative
	// names are resolved against the set.def's directory first, then the
	// simfile root prefix as a fallback for legacy flat uploads where
	// chart files live at the root despite a nested set.def. An explicit
	// `./`/`.\` prefix forces the relative branch even when the normalized
	// name collides with the id prefix — `./42/basic.dtx` means
	// `42/42/basic.dtx`, not `42/basic.dtx`. A bare id-prefixed name is
	// ambiguous between those readings (bucket key vs same-named
	// subfolder), so it also falls back to the relative candidates when
	// the direct key is absent — the same retry
	// SimFile.parseFromRemoteURLWithMetadata applies on 404 — otherwise
	// the claimed row resolves to nothing and the nested object stays
	// unreachable. Exact match first; fall back to a case-insensitive
	// lookup so that SET.DEF references like BASIC.DTX still resolve when
	// the R2 key is basic.dtx. Without these fallbacks the row is marked
	// as claimed-but-missing, which surfaces as an INTERNAL error via
	// requireCatalogChart even though the chart object exists.
	// Refs that resolve only through the ambiguous-ID retry land in a
	// subfolder below set.def — below the directory the uploader's
	// top-level-only catalog scans — so they can never be a row's
	// cataloged chart. Track them so an equal-rating exact-match tie
	// prefers a directly resolved ref over the deeper fallback object,
	// unless the fallback landed directly beside setDefBaseDir (e.g.
	// `42/42/novice.dtx` when set.def itself sits at `42/42/set.def`).
	const refsResolvedViaIdFallback = new Set<SetDefFileRef>();
	const resolveSetDefObject = (setDefRef: SetDefFileRef): R2ObjectMeta | undefined => {
		const relativeCandidates =
			setDefBaseDir === prefix
				? [`${prefix}${setDefRef.file}`]
				: [`${setDefBaseDir}${setDefRef.file}`, `${prefix}${setDefRef.file}`];
		const hasDirectCandidate =
			!setDefRef.explicitlyRelative && setDefRef.file.startsWith(prefix);
		const candidates = hasDirectCandidate
			? [setDefRef.file, ...relativeCandidates]
			: relativeCandidates;
		for (const [index, candidateKey] of candidates.entries()) {
			if (!candidateKey.toLowerCase().endsWith('.dtx')) continue;
			const matchedObject =
				objectsByKey.get(candidateKey) ?? objectsByKeyLower.get(candidateKey.toLowerCase());
			if (matchedObject) {
				if (
					hasDirectCandidate &&
					index > 0 &&
					!isTopLevelR2Key(matchedObject.key, setDefBaseDir)
				) {
					refsResolvedViaIdFallback.add(setDefRef);
				}
				return matchedObject;
			}
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
	for (const file of dtxFiles) {
		const label = file.label.toLowerCase();
		rowCountByLabel.set(label, (rowCountByLabel.get(label) ?? 0) + 1);
	}
	// A one-row/one-ref label is deterministic only when SET.def names
	// every .dtx object in the folder. When an unlisted chart exists, the
	// single ref can be an unrated placeholder (#DLEVEL 0) that
	// parse_dtx_folder skipped while cataloging the unlisted file under
	// this label — claiming it unprobed would bind the placeholder and
	// suppress the fallback that holds the row's real chart.
	const referencedKeys = new Set<string>();
	// Refs under different labels can resolve to one R2 object (./a.dtx
	// and a.dtx, or a case-insensitive collide). The claim loop consumes
	// one object per claim, so a shared key is ambiguous: a non-exact
	// claim by one label's row would take it before a row in the other
	// label holding its exact probed rating can claim it. Track the
	// label set per resolved key so shared keys can be probed and their
	// exact claims settled first.
	const labelsByResolvedKey = new Map<string, Set<string>>();
	const resolvableRefCountByLabel = new Map<string, number>();
	for (const [label, refs] of filesByLabel) {
		let resolvableCount = 0;
		for (const ref of refs) {
			const object = resolveSetDefObject(ref);
			if (!object) continue;
			resolvableCount += 1;
			referencedKeys.add(object.key);
			const labels = labelsByResolvedKey.get(object.key);
			if (labels) labels.add(label);
			else labelsByResolvedKey.set(object.key, new Set([label]));
		}
		if (resolvableCount > 0) resolvableRefCountByLabel.set(label, resolvableCount);
	}
	const hasUnlistedChart = dtxObjects.some((obj) => !referencedKeys.has(obj.key));
	// A label with no DB rows (or surplus resolvable refs) can still hold a
	// chart the uploader cataloged under another row's stem (e.g. BASIC ->
	// placeholder.dtx, EXTRA -> ./basic.dtx). Probe placeholders in that case
	// so an unrated chart is disqualified instead of suppressing stem lookup.
	let hasOtherLabelCandidate = false;
	for (const [label, count] of resolvableRefCountByLabel) {
		if (count > (rowCountByLabel.get(label) ?? 0)) {
			hasOtherLabelCandidate = true;
			break;
		}
	}
	const fileLevelByRef = new Map<SetDefFileRef, number>();
	const levelProbes: Promise<void>[] = [];
	for (const [label, refs] of filesByLabel) {
		const rows = rowCountByLabel.get(label) ?? 0;
		if (rows === 0) continue;
		for (const ref of refs) {
			const object = resolveSetDefObject(ref);
			if (!object) continue;
			// Probe only ambiguous groups: one row claiming its label's single
			// reference is already deterministic. Ambiguity needs either side
			// to multiply — multiple refs, or multiple rows sharing one
			// remaining ref (e.g. a directory placeholder removed the other) —
			// or an unlisted chart / other-label candidate the named ref could
			// wrongly displace. A key another label's ref also resolves to is
			// ambiguous too: a cross-label row can hold its exact rating.
			if (
				rows === 1 &&
				refs.length === 1 &&
				!hasUnlistedChart &&
				!hasOtherLabelCandidate &&
				(labelsByResolvedKey.get(object.key)?.size ?? 0) <= 1
			)
				continue;
			levelProbes.push(
				(async () => {
					const level = await probeChartLevel(object.key);
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
	// Settle every exact SET.def claim before any non-exact one. A row's
	// reference may resolve to an object another label also aliases
	// (./a.dtx vs a.dtx); the other label's exact claim must win that
	// object first, or reserving the unused alias leaves the first row
	// without its chart even though the other row took a different file.
	const dtxKeyOrder = new Map(dtxObjectKeys.map((key, idx) => [key, idx]));
	// The desktop uploader maps SET.def labels by raw filename (lowercased,
	// without ./ or directory prefixes), so a bare non-./ reference matching
	// the object's filename represents raw-filename ownership rather than a
	// cross-label alias.
	const isDirectRawRef = (ref: SetDefFileRef, key: string): boolean =>
		!ref.explicitlyRelative &&
		Boolean(key) &&
		ref.file.toLowerCase() === r2FileName(key).toLowerCase();
	const keysDeferredForExactMatch = new Set<string>();
	const pendingSetDefClaims = new Set<number>();
	// The reference that stopped the last claim attempt for a pending row.
	// The stem guard only yields to a direct reference deferred by a rating
	// conflict, not to one hidden behind an earlier alias block.
	const pendingSetDefClaimDeferrals = new Map<
		number,
		{ ref: SetDefFileRef; reason: 'rating' | 'rawOwner' }
	>();
	// Rows whose mismatched stem claim yielded to a pending direct SET.def
	// reference. The direct reference must retry before retained copies or
	// unprobed shortage fillers reach the fallback.
	const pendingDirectRefRows = new Set<number>();
	const probedLevelByKey = new Map<string, number>();
	let exactRatingFallbackComplete = false;
	// `usedDtxKeys` also carries leftover reservations. SET.def retries must
	// exclude only keys actually bound to a row, or a deferred row's own later
	// reference becomes unavailable before its retry.
	const keyIsAssignedToRow = (key: string): boolean => {
		for (const assignedKey of matchedKeysByRowIndex.values()) {
			if (assignedKey === key) return true;
		}
		return false;
	};

	const keyHasUnclaimedRawOwner = (key: string): boolean => {
		for (const [ownerIndex, owner] of dtxFiles.entries()) {
			if (rowsClaimedBySetDef.has(ownerIndex)) continue;
			const ownerRefs = filesByLabel.get(owner.label.toLowerCase());
			if (
				ownerRefs?.some(
					(ownerRef) =>
						resolveSetDefObject(ownerRef)?.key === key && isDirectRawRef(ownerRef, key)
				)
			) {
				return true;
			}
		}
		return false;
	};

	const uniqueUnclaimedStemOwnerIndex = (key: string): number => {
		if (!isCatalogEligibleKey(key)) return -1;
		const stem = r2FileName(key)
			.replace(/\.dtx$/i, '')
			.toLowerCase();
		const keys = dtxObjectKeys.filter(
			(candidate) =>
				isCatalogEligibleKey(candidate) &&
				r2FileName(candidate)
					.replace(/\.dtx$/i, '')
					.toLowerCase() === stem
		);
		const rootKeys =
			keys.length > 1 ? keys.filter((candidate) => isTopLevelR2Key(candidate, prefix)) : keys;
		const stemKeys = rootKeys.length === 1 ? rootKeys : keys;
		if (stemKeys.length !== 1 || stemKeys[0] !== key) return -1;
		const ownerRowIndexes = dtxFiles.flatMap((owner, ownerIndex) =>
			owner.label.toLowerCase() === stem && !rowsClaimedBySetDef.has(ownerIndex)
				? [ownerIndex]
				: []
		);
		return ownerRowIndexes.length === 1 ? ownerRowIndexes[0] : -1;
	};

	const keyHasStemOwnerWithoutRatingConflict = (
		key: string,
		probed: number | undefined,
		claimingRowIndex: number
	): boolean => {
		const ownerIndex = uniqueUnclaimedStemOwnerIndex(key);
		if (ownerIndex === -1 || ownerIndex === claimingRowIndex) return false;
		const ownerLevel = normalizeLevel(dtxFiles[ownerIndex].level);
		if (typeof probed !== 'number') return true;
		return !(
			probed !== ownerLevel &&
			dtxFiles.some(
				(file, index) =>
					index !== ownerIndex &&
					!rowsClaimedBySetDef.has(index) &&
					index !== claimingRowIndex &&
					normalizeLevel(file.level) === probed
			)
		);
	};

	const claimSetDefRows = (
		exactOnly: boolean,
		deferBlockedClaims = false,
		onlyPendingClaims = false,
		settledRatingConflicts?: ReadonlySet<number>
	): void => {
		const isRefUnassigned = (ref: SetDefFileRef): boolean => {
			const object = resolveSetDefObject(ref);
			return !object || !keyIsAssignedToRow(object.key);
		};
		const commitClaim = (rowIndex: number, refs: SetDefFileRef[], refIndex: number): void => {
			rowsClaimedBySetDef.add(rowIndex);
			const [setDefRef] = refs.splice(refIndex, 1);
			const matchedObject = resolveSetDefObject(setDefRef);
			if (matchedObject && !keyIsAssignedToRow(matchedObject.key)) {
				matchedKeysByRowIndex.set(rowIndex, matchedObject.key);
				usedDtxKeys.add(matchedObject.key);
			}
		};
		if (exactOnly) {
			// Exact aliases form a bipartite assignment problem. Greedy claiming can
			// strand a row after an earlier row takes a shared alias; augmenting paths
			// move a prior exact claim only to another exact candidate it owns.
			const keyHasUniqueUnclaimedStemOwner = (
				key: string,
				rowLevel: number,
				claimingRowIndex: number
			): boolean => {
				const ownerIndex = uniqueUnclaimedStemOwnerIndex(key);
				return (
					ownerIndex !== -1 &&
					ownerIndex !== claimingRowIndex &&
					normalizeLevel(dtxFiles[ownerIndex].level) === rowLevel
				);
			};
			const candidatesByRow = new Map<number, { refs: SetDefFileRef[]; indexes: number[] }>();
			for (const { file, index } of claimOrder) {
				if (rowsClaimedBySetDef.has(index)) continue;
				const refs = filesByLabel.get(file.label.toLowerCase());
				if (!refs?.length) continue;
				const rowLevel = normalizeLevel(file.level);
				const indexes: number[] = [];
				for (let i = 0; i < refs.length; i++) {
					if (!isRefUnassigned(refs[i]) || fileLevelByRef.get(refs[i]) !== rowLevel)
						continue;
					const object = resolveSetDefObject(refs[i]);
					if (
						object &&
						!isDirectRawRef(refs[i], object.key) &&
						keyHasUniqueUnclaimedStemOwner(object.key, rowLevel, index)
					) {
						keysDeferredForExactMatch.add(object.key);
						continue;
					}
					indexes.push(i);
				}
				if (indexes.length > 0) candidatesByRow.set(index, { refs, indexes });
			}
			for (const candidate of candidatesByRow.values()) {
				candidate.indexes.sort((a, b) => {
					const keyA = resolveSetDefObject(candidate.refs[a])?.key ?? '';
					const keyB = resolveSetDefObject(candidate.refs[b])?.key ?? '';
					return (
						Number(isDirectRawRef(candidate.refs[b], keyB)) -
							Number(isDirectRawRef(candidate.refs[a], keyA)) ||
						Number(refsResolvedViaIdFallback.has(candidate.refs[a])) -
							Number(refsResolvedViaIdFallback.has(candidate.refs[b])) ||
						(dtxKeyOrder.get(keyA) ?? Number.MAX_SAFE_INTEGER) -
							(dtxKeyOrder.get(keyB) ?? Number.MAX_SAFE_INTEGER) ||
						a - b
					);
				});
			}
			const keyOwner = new Map<string, number>();
			const assignment = new Map<number, { refs: SetDefFileRef[]; ref: SetDefFileRef }>();
			// A row holding a raw-filename claim (the uploader labelled it from
			// that very file) may only be moved onto another raw-filename
			// candidate, never onto an alias. Direct claims settle first; alias
			// claims then augment around them.
			const directRows = new Set<number>();
			const tryAssign = (
				rowIndex: number,
				seenRows: Set<number>,
				seenKeys: Set<string>,
				directOnly: boolean
			): boolean => {
				if (seenRows.has(rowIndex)) return false;
				seenRows.add(rowIndex);
				const candidate = candidatesByRow.get(rowIndex);
				if (!candidate) return false;
				for (const refIndex of candidate.indexes) {
					const ref = candidate.refs[refIndex];
					const key = resolveSetDefObject(ref)?.key;
					if (!key || seenKeys.has(key)) continue;
					const isDirect = isDirectRawRef(ref, key);
					if (directOnly && !isDirect) continue;
					seenKeys.add(key);
					const owner = keyOwner.get(key);
					if (
						owner === undefined ||
						tryAssign(owner, seenRows, seenKeys, directRows.has(owner))
					) {
						keyOwner.set(key, rowIndex);
						assignment.set(rowIndex, { refs: candidate.refs, ref });
						if (isDirect) directRows.add(rowIndex);
						else directRows.delete(rowIndex);
						return true;
					}
				}
				return false;
			};
			for (const rowIndex of candidatesByRow.keys())
				tryAssign(rowIndex, new Set(), new Set(), true);
			for (const rowIndex of candidatesByRow.keys())
				if (!assignment.has(rowIndex)) tryAssign(rowIndex, new Set(), new Set(), false);

			// Rows sharing the identical exact candidate set are indistinguishable.
			// Pair those rows to their matched keys in uploader order rather than in
			// augmenting-path order, which is an implementation artifact.
			const reorderAssignedRows = (groupRows: number[]): void => {
				if (groupRows.length < 2) return;
				const keys = groupRows
					.map(
						(row) =>
							resolveSetDefObject(assignment.get(row)?.ref as SetDefFileRef)?.key ??
							''
					)
					.sort(
						(a, b) =>
							(dtxKeyOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
							(dtxKeyOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
					);
				groupRows.sort((a, b) => a - b);
				for (const [position, rowIndex] of groupRows.entries()) {
					const candidate = candidatesByRow.get(rowIndex);
					const ref = candidate?.refs.find(
						(r) => resolveSetDefObject(r)?.key === keys[position]
					);
					if (candidate && ref) assignment.set(rowIndex, { refs: candidate.refs, ref });
				}
			};
			const rowsBySignature = new Map<string, number[]>();
			for (const [rowIndex, candidate] of candidatesByRow) {
				if (!assignment.has(rowIndex)) continue;
				const signature = candidate.indexes
					.map((i) => resolveSetDefObject(candidate.refs[i])?.key ?? '')
					.sort()
					.join('\0');
				const rows = rowsBySignature.get(signature);
				if (rows) rows.push(rowIndex);
				else rowsBySignature.set(signature, [rowIndex]);
			}
			for (const rows of rowsBySignature.values()) {
				if (rows.length < 2) continue;
				const labels = new Set(rows.map((row) => dtxFiles[row].label.toLowerCase()));
				const hasDirectClaim = rows.some((row) => {
					const assignedRef = assignment.get(row)?.ref;
					const assignedKey = assignedRef
						? resolveSetDefObject(assignedRef)?.key
						: undefined;
					return Boolean(
						assignedRef && assignedKey && isDirectRawRef(assignedRef, assignedKey)
					);
				});
				// Raw-filename ownership is a cross-label constraint: reordering
				// indistinguishable duplicate rows is fine, but it must not move a
				// directly owned file to another label's alias-only row. Direct
				// claims pin each label's key set, so reorder only within a label.
				if (hasDirectClaim && labels.size > 1) {
					const rowsByLabel = new Map<string, number[]>();
					for (const row of rows) {
						const label = dtxFiles[row].label.toLowerCase();
						const labelRows = rowsByLabel.get(label);
						if (labelRows) labelRows.push(row);
						else rowsByLabel.set(label, [row]);
					}
					for (const labelRows of rowsByLabel.values()) reorderAssignedRows(labelRows);
					continue;
				}
				reorderAssignedRows(rows);
			}
			for (const [rowIndex, claim] of assignment) {
				const refIndex = claim.refs.indexOf(claim.ref);
				if (refIndex >= 0) commitClaim(rowIndex, claim.refs, refIndex);
			}
			return;
		}
		for (const { file, index } of claimOrder) {
			if (rowsClaimedBySetDef.has(index)) continue;
			if (onlyPendingClaims && !pendingSetDefClaims.has(index)) continue;
			const label = file.label.toLowerCase();
			const refs = filesByLabel.get(label);
			if (!refs?.length) continue;
			const rowLevel = normalizeLevel(file.level);
			let refIndex = -1;
			let firstIneligibleAliasIndex = -1;
			let deferClaim = false;
			let stemOwnerBlockedClaim = false;
			for (const [candidateIndex, ref] of refs.entries()) {
				if (!isRefUnassigned(ref)) continue;
				const sharedObject = resolveSetDefObject(ref);
				// A missing reference is stronger than no fallback, but it must not
				// hide a resolved preferred candidate once a nested alias is waiting.
				if (!sharedObject && firstIneligibleAliasIndex !== -1) continue;
				// A later stem pass can learn a definitive rating by object key
				// after the short per-ref probe proved inconclusive. Retries must
				// honor that object-level evidence — especially a confirmed zero —
				// rather than treating the reference as still unprobed.
				const probed =
					fileLevelByRef.get(ref) ??
					(sharedObject ? probedLevelByKey.get(sharedObject.key) : undefined);
				// A probed level of zero names a chart the uploader never
				// catalogued — parse_dtx_folder skips unrated charts
				// (#DLEVEL 0 or absent) — so no row can own it. Left in
				// refs it stays reserved; a non-exact claim must not let
				// it displace an unlisted file that is a row's real chart.
				if (probed === 0) continue;
				const namesAnotherRowInLabel = dtxFiles.some(
					(other, otherIndex) =>
						otherIndex !== index &&
						other.label.toLowerCase() === label &&
						!rowsClaimedBySetDef.has(otherIndex) &&
						normalizeLevel(other.level) === probed &&
						probed !== rowLevel
				);
				if (namesAnotherRowInLabel) continue;
				const ratingNamesAnotherRow =
					typeof probed === 'number' &&
					probed !== rowLevel &&
					dtxFiles.some(
						(other, otherIndex) =>
							otherIndex !== index && normalizeLevel(other.level) === probed
					);
				const ratingNamesUnclaimedRow =
					ratingNamesAnotherRow &&
					dtxFiles.some(
						(other, otherIndex) =>
							otherIndex !== index &&
							!rowsClaimedBySetDef.has(otherIndex) &&
							normalizeLevel(other.level) === probed
					);
				// The resolved object can be shared with another label's
				// ref: its probed rating may name a row in THAT label,
				// whose own ref will exact-claim the shared key. A
				// non-exact claim here would consume the object first
				// (each key is claimed once) and leave the exact row to
				// the positional fallback — the alias steals its chart.
				// Exact claims have already settled by this pass, so only
				// a still-unclaimed row can need the shared object.
				if (
					sharedObject &&
					!isDirectRawRef(ref, sharedObject.key) &&
					keyHasUnclaimedRawOwner(sharedObject.key)
				) {
					// Raw ownership is meaningful only across labels. When this
					// label also names the same key bare, the alias would defer
					// behind the row's own later reference forever; skip the alias
					// so that reference can be evaluated on its own.
					const labelHasDirectRawRef = refs.some(
						(candidateRef) =>
							resolveSetDefObject(candidateRef)?.key === sharedObject.key &&
							isDirectRawRef(candidateRef, sharedObject.key)
					);
					if (labelHasDirectRawRef) continue;
					if (deferBlockedClaims) {
						pendingSetDefClaimDeferrals.set(index, { ref, reason: 'rawOwner' });
						deferClaim = true;
						break;
					}
					continue;
				}
				// A bare filename in a single-row label is the uploader's direct
				// ownership evidence. Rating conflicts still matter for aliases and
				// for repeated labels, where one shared ref list cannot show which
				// row owns which file, but they must not swap explicit cross-label
				// mappings after both charts are re-rated.
				const unambiguousDirectClaim =
					sharedObject !== undefined &&
					isDirectRawRef(ref, sharedObject.key) &&
					(rowCountByLabel.get(label) ?? 0) === 1;
				if (
					sharedObject &&
					typeof probed === 'number' &&
					probed !== 0 &&
					isCatalogEligibleKey(sharedObject.key) &&
					!unambiguousDirectClaim &&
					(ratingNamesUnclaimedRow ||
						(!exactRatingFallbackComplete &&
							ratingNamesAnotherRow &&
							!settledRatingConflicts?.has(index)))
				) {
					keysDeferredForExactMatch.add(sharedObject.key);
					if (deferBlockedClaims) {
						pendingSetDefClaimDeferrals.set(index, { ref, reason: 'rating' });
						deferClaim = true;
						break;
					}
					continue;
				}
				const sharedLabels = sharedObject
					? labelsByResolvedKey.get(sharedObject.key)
					: undefined;
				if (sharedLabels && sharedLabels.size > 1) {
					let stillNeededElsewhere = false;
					for (const otherLabel of sharedLabels) {
						if (otherLabel === label) continue;
						const stillNeedsKey = dtxFiles.some(
							(other, otherIndex) =>
								!rowsClaimedBySetDef.has(otherIndex) &&
								other.label.toLowerCase() === otherLabel &&
								normalizeLevel(other.level) === probed
						);
						if (stillNeedsKey) {
							stillNeededElsewhere = true;
							break;
						}
					}
					if (stillNeededElsewhere) continue;
				}
				// A ./ alias does not transfer the uploader's filename-stem
				// ownership to this label. Leave a unique stem owner's chart
				// available unless its rating names a different row.
				if (
					sharedObject &&
					!isDirectRawRef(ref, sharedObject.key) &&
					keyHasStemOwnerWithoutRatingConflict(sharedObject.key, probed, index)
				) {
					stemOwnerBlockedClaim = true;
					continue;
				}
				// A nested copy can still serve a row with no better SET.def
				// candidate, but catalog-eligible/raw references later in slot
				// order are the uploader's ownership evidence. Look past the
				// alias first instead of letting it displace that chart.
				if (
					sharedObject &&
					!isCatalogEligibleKey(sharedObject.key) &&
					!isDirectRawRef(ref, sharedObject.key)
				) {
					if (firstIneligibleAliasIndex === -1)
						firstIneligibleAliasIndex = candidateIndex;
					continue;
				}
				refIndex = candidateIndex;
				break;
			}
			if (refIndex === -1 && firstIneligibleAliasIndex !== -1) {
				refIndex = firstIneligibleAliasIndex;
			}
			if (deferClaim || (refIndex === -1 && stemOwnerBlockedClaim)) {
				pendingSetDefClaims.add(index);
				if (!deferClaim) pendingSetDefClaimDeferrals.delete(index);
				continue;
			}
			pendingSetDefClaimDeferrals.delete(index);
			// Every remaining ref is provably another row's chart — leave
			// them for their true rows and let this row fall through to
			// the sorted fallback.
			if (refIndex === -1) continue;
			pendingSetDefClaims.delete(index);
			commitClaim(index, refs, refIndex);
		}
	};
	claimSetDefRows(true);
	claimSetDefRows(false, true);
	claimSetDefRows(false, true, true);
	// Legacy/manual catalog rows can carry level 0 even though the desktop
	// uploader now skips unrated charts. While such a row remains unclaimed an
	// unrated object is a possible exact/positional match, not a placeholder to
	// reserve; once no zero row remains, zero-probed objects are reserved again.
	const hasUnclaimedLevelZeroRow = (): boolean =>
		dtxFiles.some(
			(file, index) => !rowsClaimedBySetDef.has(index) && normalizeLevel(file.level) === 0
		);
	const keysLeftForExactMatch = new Set<string>();
	// A nested same-stem copy that a leftover SET.def ref reserved for another
	// row's exact rating stays claimable by that rating, but is still a
	// duplicate for positional pairing.
	const sameStemAlternativeKeys = new Set<string>();
	const retainedLevelZeroRootKeys = new Set<string>();
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
	// row's chart — and a zero-probed file only claims a legacy/manual
	// level-zero row, since ordinary uploads never produce a row for an
	// unrated chart. When the resolved object sits
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
			if (!object || usedDtxKeys.has(object.key)) continue;
			let isUnratedLeftover = false;
			let deferForStemRow = false;
			if (isCatalogEligibleKey(object.key)) {
				let leftoverLevel: number | null | undefined = fileLevelByRef.get(ref);
				if (leftoverLevel === undefined) {
					leftoverLevel = await probeChartLevel(object.key);
					if (leftoverLevel !== undefined) {
						fileLevelByRef.set(ref, leftoverLevel ?? 0);
					}
				}
				isUnratedLeftover = leftoverLevel === 0 || leftoverLevel === null;
				if (isUnratedLeftover && !hasUnclaimedLevelZeroRow()) {
					usedDtxKeys.add(object.key);
					continue;
				}
				const stem = r2FileName(object.key)
					.replace(/\.dtx$/i, '')
					.toLowerCase();
				const stemRowIndexes: number[] = [];
				dtxFiles.forEach((file, index) => {
					if (
						!rowsClaimedBySetDef.has(index) &&
						file.label.toLowerCase() === stem &&
						(!isUnratedLeftover || normalizeLevel(file.level) === 0)
					) {
						stemRowIndexes.push(index);
					}
				});
				const stemRowIndex = stemRowIndexes.length === 1 ? stemRowIndexes[0] : -1;
				// A shared rating is not evidence that the leftover belongs to a
				// different row: every equal-rated row would make a same-stem ref
				// look like a stranger's chart, and the exact-rating fallback could
				// then hand this row the nested copy instead of its own root file.
				// Only a rating that differs from the stem row's own level names
				// another row.
				const stemRowLevel =
					stemRowIndex >= 0 ? normalizeLevel(dtxFiles[stemRowIndex].level) : undefined;
				const leftoverNamesAnotherRow =
					typeof leftoverLevel === 'number' &&
					leftoverLevel !== 0 &&
					leftoverLevel !== stemRowLevel &&
					dtxFiles.some(
						(file, index) =>
							index !== stemRowIndex &&
							!rowsClaimedBySetDef.has(index) &&
							normalizeLevel(file.level) === leftoverLevel
					);
				if (leftoverNamesAnotherRow && typeof leftoverLevel === 'number') {
					keysLeftForExactMatch.add(object.key);
					probedLevelByKey.set(object.key, leftoverLevel);
				}
				if (
					keysDeferredForExactMatch.has(object.key) &&
					typeof leftoverLevel === 'number'
				) {
					const exactOwnerStillNeedsKey = dtxFiles.some(
						(file, index) =>
							!rowsClaimedBySetDef.has(index) &&
							normalizeLevel(file.level) === leftoverLevel
					);
					if (exactOwnerStillNeedsKey) {
						keysLeftForExactMatch.add(object.key);
						probedLevelByKey.set(object.key, leftoverLevel);
					}
				}
				const leftoverRatingAgrees =
					typeof leftoverLevel === 'number' && leftoverLevel === stemRowLevel;
				deferForStemRow =
					stemRowIndexes.length === 1 &&
					!leftoverNamesAnotherRow &&
					!leftoverRatingAgrees;
				if (
					stemRowIndexes.length === 1 &&
					!leftoverNamesAnotherRow &&
					leftoverRatingAgrees
				) {
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
							const rootLevel = await probeChartLevel(
								rootCandidate.key,
								CHART_LEVEL_DEEP_PROBE_BYTES
							);
							if (typeof rootLevel === 'number') {
								probedLevelByKey.set(rootCandidate.key, rootLevel);
							} else if (rootLevel === null) {
								// A complete read with no #DLEVEL is confirmed unrated,
								// which the exact-level fallback represents as zero.
								probedLevelByKey.set(rootCandidate.key, 0);
							}
							const rootNamesAnotherRow =
								typeof rootLevel === 'number' &&
								rootLevel !== 0 &&
								rootLevel !== stemRowLevel &&
								dtxFiles.some(
									(file, index) =>
										index !== stemRowIndexes[0] &&
										normalizeLevel(file.level) === rootLevel
								);
							const rootIsUnrated = rootLevel === 0 || rootLevel === null;
							const anotherLevelZeroRowNeedsChart =
								rootIsUnrated &&
								dtxFiles.some(
									(file, index) =>
										index !== stemRowIndexes[0] &&
										!rowsClaimedBySetDef.has(index) &&
										normalizeLevel(file.level) === 0
								);
							if (
								typeof rootLevel === 'number' &&
								rootLevel !== 0 &&
								!rootNamesAnotherRow
							) {
								claimObject = rootCandidate;
							} else if (!rootNamesAnotherRow) {
								// Unrated or unprobed: the sibling keeps this row. Keep a
								// confirmed-unrated root available for another level-zero
								// row, but rank it after ordinary zero-level candidates —
								// it is still a copy of the stem row's chart. Without such
								// a row, reserve it from positional fallback.
								if (anotherLevelZeroRowNeedsChart) {
									retainedLevelZeroRootKeys.add(rootCandidate.key);
								} else {
									usedDtxKeys.add(rootCandidate.key);
								}
							}
							// A positive rating naming another row is stronger ownership
							// evidence than the stem: leave the root unused so the exact-
							// rating fallback can bind it to that row.
						}
					}
					if (claimObject !== object) {
						sameStemAlternativeKeys.add(object.key);
						if (typeof leftoverLevel === 'number') {
							probedLevelByKey.set(object.key, leftoverLevel);
						}
					}
					rowsClaimedBySetDef.add(stemRowIndexes[0]);
					matchedKeysByRowIndex.set(stemRowIndexes[0], claimObject.key);
					usedDtxKeys.add(claimObject.key);
				}
			}
			// Preserve unrated objects while a level-zero row stays unclaimed
			// so zero-level exact/positional matching can still bind them.
			if (
				!keysLeftForExactMatch.has(object.key) &&
				!keysDeferredForExactMatch.has(object.key) &&
				!sameStemAlternativeKeys.has(object.key) &&
				!deferForStemRow &&
				(!isUnratedLeftover || !hasUnclaimedLevelZeroRow())
			) {
				usedDtxKeys.add(object.key);
			}
		}
	}

	// Bind still-unclaimed rows to a unique unused chart whose filename
	// stem equals the row label — parse_dtx_folder catalogs unlisted
	// charts under their stem, so a one-to-one stem match is likely the
	// row's own file, not a positional guess. Likely, not provably: the
	// stem match claims the row when the candidate's probed #DLEVEL
	// equals the row's level on the normalized scale — the same identity
	// check the set.def claim loop applies to named refs — OR when its
	// rating names no catalog row at all: the uploader replaces charts
	// in place, so a re-rated file keeps its filename while its stored
	// row level stays stale, and only a rating identifying a DIFFERENT
	// row disproves the name match. A confirmed unrated candidate
	// (explicit #DLEVEL 0 or a complete-read miss) never produced a row,
	// so it is reserved rather than left for the positional fallback to
	// bind to an unrelated row. The same root-or-set.def-sibling scope
	// as the leftover-ref stem claim applies: deeper nested files are
	// never a row's chart. Stems or labels shared by more than one
	// candidate stay ambiguous and fall through to the sorted fallback,
	// whose level/filename pairing can otherwise swap difficulties when
	// the two orders disagree.
	//
	// The pass runs twice. Before the sorted fallback it claims only
	// name-and-rating agreements: a mismatched-rating stem match is a
	// weaker signal than another file's exact rating (a re-rated
	// Basic.dtx whose probe names no row is not the Basic row's chart
	// when 01.dtx probes the Basic level), so those claims defer until
	// exact-rating claims have settled and the stem heuristic applies
	// only to leftover rows and files.

	// A direct SET.def reference deferred only because an already claimed
	// row shares its probed rating is stronger evidence than a mismatched
	// filename-stem claim; let the pending-claim retry run first.
	const hasPendingDirectRefDeferredByClaimedRating = (rowIndex: number): boolean => {
		if (!pendingSetDefClaims.has(rowIndex)) return false;
		const deferral = pendingSetDefClaimDeferrals.get(rowIndex);
		if (!deferral || deferral.reason !== 'rating') return false;
		const object = resolveSetDefObject(deferral.ref);
		if (!object || keyIsAssignedToRow(object.key)) return false;
		if (!isDirectRawRef(deferral.ref, object.key) || !isCatalogEligibleKey(object.key))
			return false;
		const row = dtxFiles[rowIndex];
		const refs = filesByLabel.get(row.label.toLowerCase());
		if (!refs) return false;
		const remainingDirectRefKeys = new Set<string>();
		for (const ref of refs) {
			const refObject = resolveSetDefObject(ref);
			if (
				!refObject ||
				keyIsAssignedToRow(refObject.key) ||
				!isDirectRawRef(ref, refObject.key) ||
				!isCatalogEligibleKey(refObject.key)
			)
				continue;
			const probed = fileLevelByRef.get(ref) ?? probedLevelByKey.get(refObject.key);
			if (probed === 0) continue;
			remainingDirectRefKeys.add(refObject.key);
		}
		if (remainingDirectRefKeys.size !== 1 || !remainingDirectRefKeys.has(object.key))
			return false;
		const rowLevel = normalizeLevel(row.level);
		const probed = fileLevelByRef.get(deferral.ref) ?? probedLevelByKey.get(object.key);
		if (typeof probed !== 'number' || probed === 0 || probed === rowLevel) return false;
		const namesUnclaimedRow = dtxFiles.some(
			(other, otherIndex) =>
				otherIndex !== rowIndex &&
				!rowsClaimedBySetDef.has(otherIndex) &&
				normalizeLevel(other.level) === probed
		);
		const namesClaimedRow = dtxFiles.some(
			(other, otherIndex) =>
				otherIndex !== rowIndex &&
				rowsClaimedBySetDef.has(otherIndex) &&
				normalizeLevel(other.level) === probed
		);
		return !namesUnclaimedRow && namesClaimedRow;
	};
	const stemDeepProbedKeys = new Set<string>();
	const claimStemMatchedRows = async (
		exactOnly: boolean,
		skipRowsWithOrdinaryExactMatches = false
	): Promise<void> => {
		const unusedKeysByStem = new Map<string, string[]>();
		for (const key of dtxObjectKeys) {
			if (usedDtxKeys.has(key)) continue;
			if (!isCatalogEligibleKey(key)) continue;
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
		// A probed rating equal to a DIFFERENT unclaimed row's level names that
		// row's chart — the same disqualification the set.def claim loop applies —
		// so the file must not claim this row on its stem alone.
		for (const [stem, keys] of unusedKeysByStem) {
			const rows = unclaimedRowsByLabel.get(stem);
			// A root chart and a set.def-sibling copy sharing the stem are not
			// interchangeable: parse_dtx_folder catalogs the root file, so the
			// lone root key is the row's candidate and the nested copy stays
			// out of the positional fallback's reach.
			const rootKeys =
				keys.length > 1 ? keys.filter((k) => isTopLevelR2Key(k, prefix)) : keys;
			const stemKeys = rootKeys.length === 1 ? rootKeys : keys;
			if (stemKeys.length !== 1 || rows?.length !== 1) continue;
			const stemKey = stemKeys[0];
			// Read deeper than the pairing window like the root stem-claim
			// path — a #DLEVEL behind a long header is still a valid rating.
			let probed: number | null | undefined = probedLevelByKey.get(stemKey);
			if (probed === undefined && !stemDeepProbedKeys.has(stemKey)) {
				stemDeepProbedKeys.add(stemKey);
				probed = await probeChartLevel(stemKey, CHART_LEVEL_DEEP_PROBE_BYTES);
				if (typeof probed === 'number') probedLevelByKey.set(stemKey, probed);
				else if (probed === null) probedLevelByKey.set(stemKey, 0);
			}
			const rowLevel = normalizeLevel(dtxFiles[rows[0]].level);
			const effectiveProbed = probed === null ? 0 : probed;
			const namesDifferentRow =
				typeof effectiveProbed === 'number' &&
				effectiveProbed !== rowLevel &&
				dtxFiles.some(
					(file, index) =>
						!rowsClaimedBySetDef.has(index) &&
						normalizeLevel(file.level) === effectiveProbed
				);
			const hasOrdinaryExactMatch =
				skipRowsWithOrdinaryExactMatches &&
				dtxObjectKeys.some(
					(key) =>
						key !== stemKey &&
						!usedDtxKeys.has(key) &&
						!sameStemAlternativeKeys.has(key) &&
						!(rowLevel === 0 && retainedLevelZeroRootKeys.has(key)) &&
						isCatalogEligibleKey(key) &&
						probedLevelByKey.get(key) === rowLevel
				);
			const defersForPendingDirectRef =
				!exactOnly &&
				effectiveProbed !== rowLevel &&
				hasPendingDirectRefDeferredByClaimedRating(rows[0]);
			if (defersForPendingDirectRef) pendingDirectRefRows.add(rows[0]);
			if (
				typeof effectiveProbed === 'number' &&
				!namesDifferentRow &&
				!hasOrdinaryExactMatch &&
				!defersForPendingDirectRef &&
				(exactOnly ? effectiveProbed === rowLevel : effectiveProbed !== 0 || rowLevel === 0)
			) {
				rowsClaimedBySetDef.add(rows[0]);
				matchedKeysByRowIndex.set(rows[0], stemKey);
				usedDtxKeys.add(stemKey);
				// When a root chart wins a stem shared with a set.def-sibling copy,
				// the copy is the same filename in another directory — a duplicate,
				// not a positional candidate for a different row. A copy the
				// leftover-ref pass reserved for another row's exact rating keeps
				// that claim; positional pairing excludes it.
				if (rootKeys.length === 1) {
					for (const duplicateKey of keys) {
						if (duplicateKey === stemKey) continue;
						sameStemAlternativeKeys.add(duplicateKey);
					}
				}
			} else if (
				(probed === 0 || probed === null) &&
				rowLevel !== 0 &&
				!hasUnclaimedLevelZeroRow()
			) {
				usedDtxKeys.add(stemKey);
			}
			// An unprobed read or a rating that names a different chart proves
			// nothing either way — leave the row and the key to the fallback.
		}
	};
	await claimStemMatchedRows(true);
	claimSetDefRows(false, true, true);

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
	if (fallbackRows.length > 0) {
		await Promise.all(
			dtxObjectKeys.map(async (key) => {
				// Stem-claim candidates already carry a deeper probe result —
				// re-reading the shorter window could only downgrade a found
				// #DLEVEL to "unprobed".
				if (usedDtxKeys.has(key) || probedLevelByKey.has(key)) return;
				// Below both catalog dirs a chart can never claim a row, so
				// probing its header spends an R2 read no pass consumes.
				if (!isCatalogEligibleKey(key)) return;
				const level = await probeChartLevel(key);
				if (level === undefined) return;
				if (level === null || level === 0) {
					if (hasUnclaimedLevelZeroRow()) probedLevelByKey.set(key, 0);
					else usedDtxKeys.add(key);
					return;
				}
				probedLevelByKey.set(key, level);
			})
		);
		await claimStemMatchedRows(false, true);
		// A pending row with no filename-stem candidate still needs its
		// direct reference retried before retained copies reach the fallback.
		for (const rowIndex of pendingSetDefClaims) {
			if (hasPendingDirectRefDeferredByClaimedRating(rowIndex)) {
				pendingDirectRefRows.add(rowIndex);
			}
		}
		const exactFallbackRows = fallbackRows.filter(
			({ index }) => !rowsClaimedBySetDef.has(index)
		);
		// Rows sharing a normalized level are indistinguishable by rating
		// alone, so within an equal-rated group an unprobed key is as
		// plausible a match as a probed one — but only on a shortage.
		// When the group has enough exact-rated candidates, an earlier
		// unprobed key belongs to another row's positional claim and
		// consuming it displaces the whole tail. Each group's candidate
		// set therefore reserves probed matches first, fills only the
		// shortage with unprobed keys, and pairs the selected keys to
		// its rows in uploader filename order — otherwise the first row
		// consumes a probed key that positionally belongs to a later row
		// and the skipped unprobed key binds the wrong row. A uniquely-
		// rated row still requires an exact probed match; unprobed keys
		// stay positional there.
		const levelGroups: (typeof fallbackRows)[] = [];
		for (let groupStart = 0; groupStart < exactFallbackRows.length;) {
			const groupLevel = normalizeLevel(exactFallbackRows[groupStart].file.level);
			let groupEnd = groupStart + 1;
			while (
				groupEnd < exactFallbackRows.length &&
				normalizeLevel(exactFallbackRows[groupEnd].file.level) === groupLevel
			) {
				groupEnd += 1;
			}
			levelGroups.push(exactFallbackRows.slice(groupStart, groupEnd));
			groupStart = groupEnd;
		}
		// Retained same-stem copies are duplicates; try ordinary charts first and
		// use a copy only to fill a shortage.
		const isRetainedCopyKey = (key: string, groupLevel: number): boolean =>
			sameStemAlternativeKeys.has(key) ||
			(groupLevel === 0 && retainedLevelZeroRootKeys.has(key));
		const orderExactCandidates = (groupLevel: number, keys: string[]): string[] => {
			const isCopy = (key: string): boolean => isRetainedCopyKey(key, groupLevel);
			return [...keys.filter((key) => !isCopy(key)), ...keys.filter(isCopy)];
		};
		// Pass 1: claim groups whose full row count can be satisfied by exact
		// probed matches before any shortage fill runs, so a later exact match
		// (e.g. Expert/80) clears its slot and key before equal-rated shortage
		// fills run.
		const deferredGroups: (typeof fallbackRows)[] = [];
		for (const groupRows of levelGroups) {
			const groupLevel = normalizeLevel(groupRows[0].file.level);
			const groupSize = groupRows.length;
			const selectedKeys = new Set<string>();
			for (const key of orderExactCandidates(groupLevel, dtxObjectKeys)) {
				if (selectedKeys.size === groupSize) break;
				if (usedDtxKeys.has(key) || !isCatalogEligibleKey(key)) continue;
				if (probedLevelByKey.get(key) === groupLevel) selectedKeys.add(key);
			}
			if (selectedKeys.size < groupSize && groupSize > 1) {
				deferredGroups.push(groupRows);
				continue;
			}
			const candidates = orderExactCandidates(
				groupLevel,
				dtxObjectKeys.filter((key) => selectedKeys.has(key))
			);
			for (const [candidateIndex, row] of groupRows.entries()) {
				const key = candidates[candidateIndex];
				if (!key) break;
				// A row waiting on its direct SET.def reference may take an
				// ordinary exact match, but not a retained copy; the pending
				// retry below gets that reference back first.
				if (pendingDirectRefRows.has(row.index) && isRetainedCopyKey(key, groupLevel))
					continue;
				rowsClaimedBySetDef.add(row.index);
				matchedKeysByRowIndex.set(row.index, key);
				usedDtxKeys.add(key);
			}
		}
		if (pendingDirectRefRows.size > 0) {
			const deferredGroupRowIndexes = new Set(
				deferredGroups.flatMap((group) => group.map((row) => row.index))
			);
			const remainingRowsByPos = fallbackRows
				.filter((row) => !rowsClaimedBySetDef.has(row.index))
				.sort((a, b) => a.index - b.index);
			const positionalKeys = dtxObjectKeys
				.filter((key) => !usedDtxKeys.has(key) && isCatalogEligibleKey(key))
				.sort(
					(a, b) =>
						Number(sameStemAlternativeKeys.has(a)) -
						Number(sameStemAlternativeKeys.has(b))
				);
			// Sorted rank proves a slot owner only when the remaining key and
			// row counts match; a surplus file (e.g. an uncataloged chart)
			// must not suppress a listed direct reference's retry.
			const hasOneToOneSlots = positionalKeys.length === remainingRowsByPos.length;
			const pendingKeyCounts = new Map<string, number>();
			for (const rowIndex of pendingDirectRefRows) {
				const deferral = pendingSetDefClaimDeferrals.get(rowIndex);
				const key = deferral ? resolveSetDefObject(deferral.ref)?.key : undefined;
				if (key) pendingKeyCounts.set(key, (pendingKeyCounts.get(key) ?? 0) + 1);
			}
			const retryRows = new Set<number>();
			for (const rowIndex of pendingDirectRefRows) {
				const deferral = pendingSetDefClaimDeferrals.get(rowIndex);
				const deferralKey = deferral ? resolveSetDefObject(deferral.ref)?.key : undefined;
				const sharedPendingKey =
					deferralKey !== undefined && (pendingKeyCounts.get(deferralKey) ?? 0) > 1;
				if (
					!deferredGroupRowIndexes.has(rowIndex) ||
					(!hasOneToOneSlots && !sharedPendingKey)
				) {
					retryRows.add(rowIndex);
					continue;
				}
				const row = dtxFiles[rowIndex];
				const rowLevel = normalizeLevel(row.level);
				const pos = remainingRowsByPos.findIndex((entry) => entry.index === rowIndex);
				const slotKey = pos >= 0 ? positionalKeys[pos] : undefined;
				// An ordinary exact match in this row's uploader slot settles
				// first; retrying the re-rated direct reference here would give
				// the slot file to the other row. A shared pending key must
				// still yield when its slot file has a catalog stem owner.
				const slotHasStemOwner =
					slotKey !== undefined &&
					dtxFiles.some(
						(file, index) =>
							!rowsClaimedBySetDef.has(index) &&
							file.label.toLowerCase() ===
								r2FileName(slotKey)
									.replace(/\.dtx$/i, '')
									.toLowerCase()
					);
				if (
					slotKey !== undefined &&
					!isRetainedCopyKey(slotKey, rowLevel) &&
					probedLevelByKey.get(slotKey) === rowLevel &&
					(!sharedPendingKey || slotHasStemOwner)
				)
					continue;
				retryRows.add(rowIndex);
			}
			if (retryRows.size > 0) {
				claimSetDefRows(false, true, true, retryRows);
			}
		}
		// Pass 2: for equal-rated groups with an exact-match shortage, only fill
		// from unprobed keys whose remaining uploader-position slot belongs to
		// a row inside the group — never steal an unprobed key whose position
		// maps to an unclaimed row outside the group.
		for (const [deferredIndex, groupRows] of deferredGroups.entries()) {
			// The pending retry can fill part of a deferred group. Size the
			// shortage against the rows that still need a chart, or an
			// unprobed filler can displace the remaining row's exact match.
			const unclaimedGroupRows = groupRows.filter(
				(row) => !rowsClaimedBySetDef.has(row.index)
			);
			if (unclaimedGroupRows.length === 0) continue;
			const groupLevel = normalizeLevel(unclaimedGroupRows[0].file.level);
			const groupSize = unclaimedGroupRows.length;
			const groupRowIndexes = new Set(unclaimedGroupRows.map((row) => row.index));
			const remainingRowsByPos = fallbackRows
				.filter((row) => !rowsClaimedBySetDef.has(row.index))
				.sort((a, b) => a.index - b.index);
			const remainingEligibleKeys = dtxObjectKeys.filter(
				(key) => !usedDtxKeys.has(key) && isCatalogEligibleKey(key)
			);
			// A retained nested copy is not an uploader file, so it must not
			// occupy a positional slot: rank copies after ordinary keys exactly
			// like the final fallback before mapping key positions to rows.
			const positionalKeys = [...remainingEligibleKeys].sort(
				(a, b) =>
					Number(sameStemAlternativeKeys.has(a)) - Number(sameStemAlternativeKeys.has(b))
			);
			const posByKey = new Map(positionalKeys.map((key, pos) => [key, pos]));
			// Within each priority tier, an exact file in a remaining row's
			// uploader slot outranks an off-slot exact file, or the cap can
			// discard the slot owner before positional matching.
			const isOnSlot = (key: string): boolean => {
				const pos = posByKey.get(key);
				const positionalRow = pos !== undefined ? remainingRowsByPos[pos] : undefined;
				return Boolean(positionalRow && groupRowIndexes.has(positionalRow.index));
			};
			const hasFutureGroupRowAtLevel = (level: number): boolean => {
				for (let i = deferredIndex + 1; i < deferredGroups.length; i++) {
					for (const row of deferredGroups[i]) {
						if (
							!rowsClaimedBySetDef.has(row.index) &&
							normalizeLevel(row.file.level) === level
						)
							return true;
					}
				}
				return false;
			};
			const hasViableDeferredDirectRef = (
				rowIndex: number,
				excludingKey: string
			): boolean => {
				if (groupRowIndexes.has(rowIndex) || rowsClaimedBySetDef.has(rowIndex))
					return false;
				const deferral = pendingSetDefClaimDeferrals.get(rowIndex);
				if (!deferral || deferral.reason !== 'rating') return false;
				const object = resolveSetDefObject(deferral.ref);
				if (!object || object.key === excludingKey) return false;
				if (!isDirectRawRef(deferral.ref, object.key)) return false;
				const probed = fileLevelByRef.get(deferral.ref) ?? probedLevelByKey.get(object.key);
				if (typeof probed !== 'number' || probed === 0) return false;
				// A later rating group can still take this reference before
				// the owner's retry; keep the filename match protected then.
				if (hasFutureGroupRowAtLevel(probed)) return false;
				return !keyIsAssignedToRow(object.key) && isCatalogEligibleKey(object.key);
			};
			const consumesOtherRowsFilename = (key: string): boolean => {
				const ownerIndex = uniqueUnclaimedStemOwnerIndex(key);
				if (ownerIndex === -1 || groupRowIndexes.has(ownerIndex)) return false;
				// If the owner can still retry its own deferred SET.def
				// reference, this stem match is not its only claim.
				return !hasViableDeferredDirectRef(ownerIndex, key);
			};
			const isDeferredDirectRefOfOtherRow = (key: string): boolean => {
				for (const [rowIndex, deferral] of pendingSetDefClaimDeferrals) {
					if (groupRowIndexes.has(rowIndex) || rowsClaimedBySetDef.has(rowIndex))
						continue;
					if (deferral.reason !== 'rating') continue;
					const object = resolveSetDefObject(deferral.ref);
					if (!object || object.key !== key) continue;
					if (!isDirectRawRef(deferral.ref, object.key)) continue;
					if (keyIsAssignedToRow(object.key) || !isCatalogEligibleKey(object.key))
						continue;
					return true;
				}
				return false;
			};
			const candidateRank = (key: string): number => {
				if (isDeferredDirectRefOfOtherRow(key)) return 2;
				if (consumesOtherRowsFilename(key)) return 1;
				return 0;
			};
			const orderDeferredCandidates = (keys: string[]): string[] => {
				const ordered = orderExactCandidates(groupLevel, keys);
				const bySlot = (tier: string[]): string[] =>
					[0, 1, 2].flatMap((rank) => {
						const ranked = tier.filter((key) => candidateRank(key) === rank);
						return [
							...ranked.filter(isOnSlot),
							...ranked.filter((key) => !isOnSlot(key))
						];
					});
				return [
					...bySlot(ordered.filter((key) => !isRetainedCopyKey(key, groupLevel))),
					...bySlot(ordered.filter((key) => isRetainedCopyKey(key, groupLevel)))
				];
			};
			const selectedKeys = new Set<string>();
			for (const key of orderDeferredCandidates(remainingEligibleKeys)) {
				if (selectedKeys.size === groupSize) break;
				if (probedLevelByKey.get(key) === groupLevel) selectedKeys.add(key);
			}
			if (selectedKeys.size < groupSize) {
				for (const [pos, key] of positionalKeys.entries()) {
					if (selectedKeys.size === groupSize) break;
					if (selectedKeys.has(key) || probedLevelByKey.has(key)) continue;
					const positionalRow = remainingRowsByPos[pos];
					if (positionalRow && groupRowIndexes.has(positionalRow.index)) {
						selectedKeys.add(key);
					}
				}
			}
			const candidates = orderDeferredCandidates(
				remainingEligibleKeys.filter((key) => selectedKeys.has(key))
			);
			const unassignedCandidates: string[] = [];
			// Keep candidates whose uploader position belongs to a row in this
			// group with that positional owner first, so a short candidate list
			// does not shift later candidates onto earlier rows.
			for (const key of candidates) {
				const pos = posByKey.get(key);
				const positionalRow = pos !== undefined ? remainingRowsByPos[pos] : undefined;
				if (
					positionalRow &&
					groupRowIndexes.has(positionalRow.index) &&
					!rowsClaimedBySetDef.has(positionalRow.index)
				) {
					rowsClaimedBySetDef.add(positionalRow.index);
					matchedKeysByRowIndex.set(positionalRow.index, key);
					usedDtxKeys.add(key);
				} else {
					unassignedCandidates.push(key);
				}
			}
			let unassignedIndex = 0;
			for (const row of unclaimedGroupRows) {
				if (rowsClaimedBySetDef.has(row.index)) continue;
				const key = unassignedCandidates[unassignedIndex++];
				if (!key) break;
				rowsClaimedBySetDef.add(row.index);
				matchedKeysByRowIndex.set(row.index, key);
				usedDtxKeys.add(key);
			}
		}
	}
	exactRatingFallbackComplete = true;

	claimSetDefRows(false, true, true);

	// Re-rated leftovers: with exact-rating claims settled, a unique stem
	// match whose probed rating names no catalog row is still likely the
	// row's own re-rated file — the uploader replaces charts in place, so
	// the filename survives while the stored row level stays stale.
	// Claiming it earlier would let the weaker name match displace another
	// file's exact rating.
	await claimStemMatchedRows(false);
	claimSetDefRows(false, true, true);
	if (!hasUnclaimedLevelZeroRow()) {
		for (const key of dtxObjectKeys) {
			if (!usedDtxKeys.has(key) && probedLevelByKey.get(key) === 0) usedDtxKeys.add(key);
		}
	}

	// What remains is genuinely positional: rows arrive in id order —
	// the uploader's filename order (parse_dtx_folder emits rows in
	// files.sort() order) — so pair remaining rows in row order with
	// remaining keys in key order, reproducing the uploader's own
	// row↔file correspondence instead of assuming filenames sort by
	// difficulty. The pool prefers the catalog scope: an uncataloged
	// nested file is never a row's chart and must not take a positional
	// slot while an eligible candidate remains. When NO eligible
	// candidate is left and the leftover objects match the remaining
	// rows one-to-one — a legacy simfile whose charts all sit below the
	// catalog dirs — there is nothing to displace and nothing to guess
	// between, so the full leftover pool pairs as it did before the
	// scope.
	const positionalRows = fallbackRows
		.filter(({ index }) => !rowsClaimedBySetDef.has(index))
		.sort((a, b) => a.index - b.index);
	const unusedKeys = dtxObjectKeys.filter((key) => !usedDtxKeys.has(key));
	const ordinaryUnusedKeys = unusedKeys.filter((key) => !sameStemAlternativeKeys.has(key));
	const fallbackKeys = ordinaryUnusedKeys.filter(isCatalogEligibleKey);
	if (fallbackKeys.length === 0 && ordinaryUnusedKeys.length === positionalRows.length) {
		fallbackKeys.push(...ordinaryUnusedKeys);
	}
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
