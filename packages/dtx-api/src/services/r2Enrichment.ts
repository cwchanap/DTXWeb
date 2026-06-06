import {
	listAllR2Objects,
	isPreviewKey,
	decodeArrayBufferWithBomDetection,
	type R2ObjectMeta,
	type WorkerLogger
} from '@dtx/common/server';
import type { R2Bucket } from '@cloudflare/workers-types';

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

const toPublicUrl = (publicBaseUrl: string, key: string): string => {
	const baseUrl = publicBaseUrl.replace(/\/+$/, '');
	return `${baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
};

const getFileName = (key: string): string => key.split('/').at(-1) ?? '';

const isPreviewMp3Key = (key: string): boolean => getFileName(key).toLowerCase() === 'preview.mp3';

const normalizeSetDefValue = (value: string): string => value.trim().replaceAll('\\', '/');

const resolveSetDefFileKey = (prefix: string, fileName: string): string => {
	const normalizedFileName = normalizeSetDefValue(fileName);
	return normalizedFileName.startsWith(prefix)
		? normalizedFileName
		: `${prefix}${normalizedFileName}`;
};

const parseSetDefFilesByLabel = (setDefText: string, prefix: string): Map<string, string[]> => {
	const entries = new Map<string, { label?: string; file?: string }>();
	// Match the separator accepted by the editor loader at
	// packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.server.ts
	// so set.def files written with the colon form (#L1LABEL: BASIC) are
	// parsed the same way here as they are in the editor.
	const levelLinePattern = /^#L(\d+)(LABEL|FILE)(?:\s*:\s*|\s+)(.+)$/i;
	for (const line of setDefText.split(/\r?\n/)) {
		const match = line.match(levelLinePattern);
		if (!match) continue;
		const [, level, kind, value] = match;
		const entry = entries.get(level) ?? {};
		if (kind.toUpperCase() === 'LABEL') {
			entry.label = value.trim();
		} else {
			entry.file = resolveSetDefFileKey(prefix, value);
		}
		entries.set(level, entry);
	}

	// A single label can legitimately appear on multiple L-slots (e.g. two
	// charts both labelled "BASIC"). Collecting an array per label — rather
	// than a single value keyed by label alone — preserves every distinct
	// file so the consumer can assign one file per matching DB row instead
	// of overwriting earlier entries and silently collapsing two rows onto
	// the same R2 object. The `entries` map is keyed by L-slot and iterated
	// in insertion order (L1 before L2 …), so the array stays in slot order.
	const filesByLabel = new Map<string, string[]>();
	for (const entry of entries.values()) {
		if (entry.label && entry.file) {
			const key = entry.label.toLowerCase();
			const list = filesByLabel.get(key);
			if (list) {
				list.push(entry.file);
			} else {
				filesByLabel.set(key, [entry.file]);
			}
		}
	}
	return filesByLabel;
};

const readSetDefFilesByLabel = async (
	bucket: R2Bucket,
	setDefKey: string | undefined,
	prefix: string,
	logger: WorkerLogger
): Promise<Map<string, string[]>> => {
	if (!setDefKey) return new Map();

	try {
		const object = await bucket.get(setDefKey);
		if (!object) return new Map();
		// Decode with BOM detection: set.def files in this app are routinely
		// written as UTF-16LE with BOM (see packages/dtx-desktop/src/main/index.ts)
		// or UTF-8 with BOM. The default R2 text() path decodes as UTF-8 and
		// would either garble UTF-16LE content or leave a BOM on the first
		// directive, causing the regex match to miss and silently fall back to
		// sorted-key pairing.
		const setDefText = decodeArrayBufferWithBomDetection(await object.arrayBuffer());
		return parseSetDefFilesByLabel(setDefText, prefix);
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
	const canonicalPreviewKey = `${prefix}preview.mp3`.toLowerCase();
	const previewObject =
		objects.find((obj: R2ObjectMeta) => obj.key.toLowerCase() === canonicalPreviewKey) ??
		objects.find((obj: R2ObjectMeta) => isPreviewMp3Key(obj.key));
	const previewUrl = previewObject ? toPublicUrl(publicBaseUrl, previewObject.key) : null;

	const audioExts = ['.ogg', '.mp3', '.wav', '.flac'];
	const isAudio = (key: string): boolean => {
		const lower = key.toLowerCase();
		return audioExts.some((ext) => lower.endsWith(ext)) && !isPreviewMp3Key(key);
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
	const isTopLevelKey = (key: string): boolean => !key.slice(prefix.length).includes('/');
	// Top-level must win over extension: a top-level .mp3 backing track
	// is the full-audio download candidate even when nested .ogg sample
	// chips exist, because .ogg has higher extension priority. Checking
	// extension first would sort the nested sample ahead of the backing
	// track and point downloadUrl at a drum chip instead of full audio.
	const audioObjects = objects
		.filter((obj: R2ObjectMeta) => isAudio(obj.key))
		.sort((a, b) => {
			const aTop = isTopLevelKey(a.key);
			const bTop = isTopLevelKey(b.key);
			if (aTop !== bTop) return aTop ? -1 : 1;
			const aExt = audioExts.findIndex((ext) => a.key.toLowerCase().endsWith(ext));
			const bExt = audioExts.findIndex((ext) => b.key.toLowerCase().endsWith(ext));
			if (aExt !== bExt) return aExt - bExt;
			return a.key.localeCompare(b.key);
		});
	const downloadObject = audioObjects[0];
	const downloadUrl = downloadObject ? toPublicUrl(publicBaseUrl, downloadObject.key) : null;

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
	const canonicalSetDefKey = `${prefix}set.def`.toLowerCase();
	const setDefKey =
		objects.find((obj: R2ObjectMeta) => obj.key.toLowerCase() === canonicalSetDefKey)?.key ??
		objects.find((obj: R2ObjectMeta) => getFileName(obj.key).toLowerCase() === 'set.def')?.key;
	// Skip fetching set.def when no chart rows need matching — preview-only
	// requests never read filesByLabel, so we avoid an unnecessary R2 GET.
	const filesByLabel =
		dtxFiles.length > 0
			? await readSetDefFilesByLabel(bucket, setDefKey, prefix, logger)
			: new Map<string, string[]>();

	const matchedKeysByRowIndex = new Map<number, string>();
	// Rows with an explicit set.def label→file mapping are "claimed" by
	// set.def regardless of whether the referenced R2 object exists. This
	// prevents the sorted-key fallback from assigning an unrelated .dtx
	// key to a chart whose intended file is missing — which would silently
	// serve the wrong chart instead of the correct missing-chart null.
	const rowsClaimedBySetDef = new Set<number>();
	for (const [index, file] of dtxFiles.entries()) {
		// Consume one SET.def file per matching row so that duplicate labels
		// each claim a distinct R2 object instead of all collapsing onto the
		// last-inserted entry. Files are accumulated in L-slot order (see
		// parseSetDefFilesByLabel), so the first matching row gets the first
		// slot's file, the second row gets the second, etc.
		const setDefKeyForFile = filesByLabel.get(file.label.toLowerCase())?.shift();
		if (setDefKeyForFile) {
			rowsClaimedBySetDef.add(index);
			// Exact match first; fall back to a case-insensitive lookup so
			// that SET.DEF references like BASIC.DTX still resolve when the
			// R2 key is basic.dtx. Without this fallback the row is marked
			// as claimed-but-missing, which surfaces as an INTERNAL error
			// via requireCatalogChart even though the chart object exists.
			const exactObject = objectsByKey.get(setDefKeyForFile);
			const matchedObject =
				exactObject ?? objectsByKeyLower.get(setDefKeyForFile.toLowerCase());
			if (matchedObject) {
				matchedKeysByRowIndex.set(index, matchedObject.key);
				usedDtxKeys.add(matchedObject.key);
			}
		}
	}

	const fallbackRows = dtxFiles
		.map((file, index) => ({ file, index }))
		.filter(({ index }) => !rowsClaimedBySetDef.has(index))
		.sort(
			(a, b) =>
				a.file.level - b.file.level ||
				a.file.label.localeCompare(b.file.label) ||
				a.index - b.index
		);
	const fallbackKeys = dtxObjectKeys.filter((key) => !usedDtxKeys.has(key));
	for (const [fallbackIndex, row] of fallbackRows.entries()) {
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
			fileUrl: toPublicUrl(publicBaseUrl, object.key),
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
	let cursor: string | undefined;
	let truncated: boolean;
	const MAX_PAGES = 1000;
	let pages = 0;
	do {
		if (++pages > MAX_PAGES) {
			throw new Error(
				`R2 pagination exceeded MAX_PAGES in enrichHasUploadedFiles for simfile ${simfileId}`
			);
		}
		const listed = await bucket.list({ prefix, cursor });
		for (const obj of listed.objects) {
			if (obj.key.length > prefix.length && !isPreviewKey(obj.key)) {
				return true;
			}
		}
		truncated = listed.truncated;
		if (truncated) {
			const nextCursor = (listed as { cursor?: string }).cursor;
			if (!nextCursor || nextCursor === cursor) {
				throw new Error(
					`R2 pagination stalled in enrichHasUploadedFiles for simfile ${simfileId}`
				);
			}
			cursor = nextCursor;
		}
	} while (truncated);
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
