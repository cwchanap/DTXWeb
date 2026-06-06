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
const DOWNLOAD_EXTENSION_PRIORITY = ['.ogg', '.mp3', '.wav', '.flac'] as const;

const toPublicUrl = (publicBaseUrl: string, key: string): string => {
	const baseUrl = publicBaseUrl.replace(/\/+$/, '');
	return `${baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
};

const getFileName = (key: string): string => key.split('/').at(-1) ?? '';

const isPreviewMp3Key = (key: string): boolean => getFileName(key).toLowerCase() === 'preview.mp3';

const getExtension = (key: string): string => {
	const fileName = getFileName(key);
	const dotIndex = fileName.lastIndexOf('.');
	return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
};

const normalizeSetDefValue = (value: string): string => value.trim().replaceAll('\\', '/');

const resolveSetDefFileKey = (prefix: string, fileName: string): string => {
	const normalizedFileName = normalizeSetDefValue(fileName);
	return normalizedFileName.startsWith(prefix)
		? normalizedFileName
		: `${prefix}${normalizedFileName}`;
};

const parseSetDefFilesByLabel = (setDefText: string, prefix: string): Map<string, string> => {
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

	const filesByLabel = new Map<string, string>();
	for (const entry of entries.values()) {
		if (entry.label && entry.file) {
			filesByLabel.set(entry.label.toLowerCase(), entry.file);
		}
	}
	return filesByLabel;
};

const readSetDefFilesByLabel = async (
	bucket: R2Bucket,
	setDefKey: string | undefined,
	prefix: string,
	logger: WorkerLogger
): Promise<Map<string, string>> => {
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

	const previewObject = objects
		.slice()
		.sort((a: R2ObjectMeta, b: R2ObjectMeta) => a.key.localeCompare(b.key))
		.find((obj: R2ObjectMeta) => isPreviewMp3Key(obj.key));
	const previewUrl = previewObject ? toPublicUrl(publicBaseUrl, previewObject.key) : null;

	const downloadObject = objects
		.filter((obj: R2ObjectMeta) => !isPreviewMp3Key(obj.key))
		.map((obj: R2ObjectMeta) => ({
			object: obj,
			priority: DOWNLOAD_EXTENSION_PRIORITY.indexOf(
				getExtension(obj.key) as (typeof DOWNLOAD_EXTENSION_PRIORITY)[number]
			)
		}))
		.filter(({ priority }) => priority !== -1)
		.sort(
			(a, b) => a.priority - b.priority || a.object.key.localeCompare(b.object.key)
		)[0]?.object;
	const downloadUrl = downloadObject ? toPublicUrl(publicBaseUrl, downloadObject.key) : null;

	const dtxObjects = objects
		.filter((obj: R2ObjectMeta) => obj.key.toLowerCase().endsWith('.dtx'))
		.sort((a: R2ObjectMeta, b: R2ObjectMeta) => a.key.localeCompare(b.key));
	const dtxObjectKeys = dtxObjects.map((obj: R2ObjectMeta) => obj.key);
	const usedDtxKeys = new Set<string>();

	const setDefKey = objects.find(
		(obj: R2ObjectMeta) => getFileName(obj.key).toLowerCase() === 'set.def'
	)?.key;
	// Skip fetching set.def when no chart rows need matching — preview/download-only
	// requests never read filesByLabel, so we avoid an unnecessary R2 GET.
	const filesByLabel =
		dtxFiles.length > 0
			? await readSetDefFilesByLabel(bucket, setDefKey, prefix, logger)
			: new Map<string, string>();

	const matchedKeysByRowIndex = new Map<number, string>();
	// Rows with an explicit set.def label→file mapping are "claimed" by
	// set.def regardless of whether the referenced R2 object exists. This
	// prevents the sorted-key fallback from assigning an unrelated .dtx
	// key to a chart whose intended file is missing — which would silently
	// serve the wrong chart instead of the correct missing-chart null.
	const rowsClaimedBySetDef = new Set<number>();
	for (const [index, file] of dtxFiles.entries()) {
		const setDefKeyForFile = filesByLabel.get(file.label.toLowerCase());
		if (setDefKeyForFile) {
			rowsClaimedBySetDef.add(index);
			if (objectsByKey.has(setDefKeyForFile)) {
				matchedKeysByRowIndex.set(index, setDefKeyForFile);
				usedDtxKeys.add(setDefKeyForFile);
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
