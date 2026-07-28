import { GraphQLError, type GraphQLResolveInfo, type SelectionNode } from 'graphql';
import {
	getSimfile,
	getNextDisplayId,
	listSimfiles,
	listUserScoredSimfiles,
	searchSimfiles,
	toSimfileWithDtx,
	updateSimfile,
	updateSimfileDriveFile,
	deleteSimfile,
	getUserChartScore,
	listUserChartScores,
	type SimfileWithDtxFiles
} from '@dtx/common/server';
import { builder } from './builder';
import { ChartScoreRef } from './score';
import {
	enrichFiles,
	enrichHasUploadedFiles,
	batchEnrichHasUploadedFiles,
	batchEnrichFiles,
	batchDiscoverCatalogFiles,
	discoverCatalogFiles
} from '../services/r2Enrichment';
import type {
	CatalogChartFile,
	CatalogChartFilePresent,
	CatalogFileDiscovery
} from '../services/r2Enrichment';
import { createSimfileWithDtx } from '../services/createSimfile';
import type { Ctx } from '../context';

/**
 * Checks whether a given field name appears in the selection set of the
 * current field's return type. Used to gate expensive batched R2 lookups
 * so they only fire when the client actually requests the field.
 *
 * Resolves fragment spreads and inline fragments recursively so that fields
 * selected via fragments are detected. Walks all fieldNodes (not just the
 * first) to handle merged fragments correctly. `__typename` fields are
 * skipped to avoid false positives from auto-injected introspection fields.
 */
const isFieldSelected = (info: GraphQLResolveInfo, fieldName: string): boolean => {
	const fieldNodes = info.fieldNodes;
	if (!fieldNodes.length) return false;

	const checkSelections = (selections: readonly SelectionNode[]): boolean =>
		selections.some((sel) => {
			switch (sel.kind) {
				case 'Field':
					return sel.name.value !== '__typename' && sel.name.value === fieldName;
				case 'FragmentSpread': {
					const fragment = info.fragments[sel.name.value];
					return fragment ? checkSelections(fragment.selectionSet.selections) : false;
				}
				case 'InlineFragment':
					return checkSelections(sel.selectionSet.selections);
				default:
					return false;
			}
		});

	return fieldNodes.some((node) => {
		const selectionSet = node.selectionSet;
		if (!selectionSet) return false;
		return checkSelections(selectionSet.selections);
	});
};

const isNestedFieldSelected = (
	info: GraphQLResolveInfo,
	parentFieldName: string,
	childFieldNames: string[]
): boolean => {
	const childFields = new Set(childFieldNames);

	const checkChildSelections = (selections: readonly SelectionNode[]): boolean =>
		selections.some((sel) => {
			switch (sel.kind) {
				case 'Field':
					return sel.name.value !== '__typename' && childFields.has(sel.name.value);
				case 'FragmentSpread': {
					const fragment = info.fragments[sel.name.value];
					return fragment
						? checkChildSelections(fragment.selectionSet.selections)
						: false;
				}
				case 'InlineFragment':
					return checkChildSelections(sel.selectionSet.selections);
				default:
					return false;
			}
		});

	const checkParentSelections = (selections: readonly SelectionNode[]): boolean =>
		selections.some((sel) => {
			switch (sel.kind) {
				case 'Field':
					if (sel.name.value === '__typename' || sel.name.value !== parentFieldName) {
						return false;
					}
					return sel.selectionSet
						? checkChildSelections(sel.selectionSet.selections)
						: false;
				case 'FragmentSpread': {
					const fragment = info.fragments[sel.name.value];
					return fragment
						? checkParentSelections(fragment.selectionSet.selections)
						: false;
				}
				case 'InlineFragment':
					return checkParentSelections(sel.selectionSet.selections);
				default:
					return false;
			}
		});

	return info.fieldNodes.some((node) => {
		const selectionSet = node.selectionSet;
		if (!selectionSet) return false;
		return checkParentSelections(selectionSet.selections);
	});
};

// --- enums ---

export const SimfileScopeEnum = builder.enumType('SimfileScope', {
	values: ['MINE', 'PUBLISHED'] as const
});

export const FileEncodingEnum = builder.enumType('FileEncoding', {
	values: ['SHIFT_JIS', 'UTF_8'] as const
});

// --- object types ---

type DtxFileParent = {
	id: number;
	level: number;
	label: string;
	/** Row index within simfile.dtx_files. Carried so the resolver can
	 * look up the chart by position rather than by (label, level),
	 * which is not unique — duplicate dtx_files rows with the same
	 * label+level would otherwise all resolve to the first chart. */
	index: number;
	simfile: SimfileWithDtxFiles;
};

/**
 * Returns the value if it is a non-empty, non-whitespace string; otherwise
 * null. The DB can store `''` for preview_url/download_url because the
 * ChartDetail form submits empty inputs as empty strings, and the update
 * resolver passes those through verbatim. Treat such values the same as
 * NULL so the catalog-fallback path runs and clients don't receive a
 * blank URL.
 */
const nonBlank = (value: string | null | undefined): string | null =>
	value != null && value.trim() !== '' ? value : null;

/**
 * Filters a download_url value for both read and write paths.
 *
 * R2 bucket URLs (e.g. `https://chart.hapadona.com/375/bass.ogg`) are
 * drum sample chips, not external download links. The old resolver
 * returned discovered sample-chip URLs as downloadUrl, ChartDetail
 * pre-populated the edit form with that value, and saving wrote it
 * back to the DB — polluting download_url for many simfiles.
 *
 * This helper strips any value that starts with PUBLIC_SIMFILE_BUCKET_URL
 * so that:
 *   - the read resolver returns null (renders "download not available")
 *   - all write mutations refuse to persist R2 bucket URLs
 *
 * Genuine external links (Google Drive, etc.) are preserved.
 */
const filterDownloadUrl = (
	value: string | null | undefined,
	bucketUrl: string | undefined
): string | null => {
	const url = nonBlank(value);
	if (url == null) return null;
	if (bucketUrl && url.startsWith(bucketUrl)) return null;
	return url;
};

const badDriveInput = (message: string): never => {
	throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
};

const normalizeGoogleDriveFileId = (value: string): string => {
	const trimmed = value.trim();
	if (!trimmed) badDriveInput('Google Drive file ID is required');
	if (trimmed.length > 256) badDriveInput('Google Drive file ID is too long');
	return trimmed;
};

const normalizeGoogleDriveDownloadUrl = (value: string, bucketUrl: string | undefined): string => {
	const trimmed = value.trim();
	if (!trimmed) badDriveInput('Download URL is required');
	if (trimmed.length > 2048) badDriveInput('Download URL is too long');
	try {
		if (new URL(trimmed).protocol !== 'https:') {
			badDriveInput('Download URL must use HTTPS');
		}
	} catch (error) {
		if (error instanceof GraphQLError) throw error;
		badDriveInput('Download URL must be a valid HTTPS URL');
	}
	if (filterDownloadUrl(trimmed, bucketUrl) == null) {
		badDriveInput('Download URL must not point to the simfile bucket');
	}
	return trimmed;
};

const getCatalogDiscovery = (
	ctx: Ctx,
	simfile: SimfileWithDtxFiles
): Promise<CatalogFileDiscovery> => {
	const cache = ctx.catalogFilesCache ?? (ctx.catalogFilesCache = new Map());
	const cached = cache.get(simfile.id);
	if (cached) return cached;

	const promise = discoverCatalogFiles(
		ctx.r2,
		{
			simfileId: simfile.id,
			dtxFiles: simfile.dtx_files,
			publicBaseUrl: ctx.env.PUBLIC_SIMFILE_BUCKET_URL
		},
		ctx.logger
	);
	cache.set(simfile.id, promise);
	return promise;
};

const findCatalogChart = async (
	ctx: Ctx,
	parent: DtxFileParent
): Promise<CatalogChartFile | undefined> => {
	const discovery = await getCatalogDiscovery(ctx, parent.simfile);
	if (!discovery.chartsPopulated) {
		// The cache entry was populated by a URL-only batch (no chart
		// fields were selected at batch time). Invalidate and re-discover
		// with the full dtx_files so chart matching runs. This handles
		// the aliased-query scenario where a list (URL-only) and a
		// detail (chart fields) share the same request-scoped cache.
		ctx.catalogFilesCache?.delete(parent.simfile.id);
		const fullDiscovery = await getCatalogDiscovery(ctx, parent.simfile);
		return fullDiscovery.charts[parent.index];
	}
	// Resolve by row index, not by (label, level) search. The charts
	// array is built positionally (dtxFiles.map((file, index) => ...)),
	// so charts[index] is the exact match for this dtx_files row.
	// A .find() by label+level would return the first chart for every
	// duplicate row, exposing the wrong R2 object for the second row.
	return discovery.charts[parent.index];
};

/**
 * Returns the catalog chart for the given DTX row, or throws an INTERNAL
 * GraphQLError if the backing R2 object is missing. The discriminated-
 * union return type (CatalogChartFilePresent) guarantees fileUrl and
 * fileSizeBytes are both present, so callers get non-null values without
 * defensive fallbacks.
 */
const requireCatalogChart = async (
	ctx: Ctx,
	parent: DtxFileParent
): Promise<CatalogChartFilePresent> => {
	const chart = await findCatalogChart(ctx, parent);
	if (!chart || chart.fileUrl === null) {
		ctx.logger.error('DTX chart file missing in R2', {
			simfileId: parent.simfile.id,
			label: parent.label,
			level: parent.level
		});
		throw new GraphQLError('DTX chart file not found in R2', {
			extensions: { code: 'INTERNAL' }
		});
	}
	return chart;
};

const DtxFile = builder.objectRef<DtxFileParent>('DtxFile').implement({
	fields: (t) => ({
		id: t.id({ resolve: (file) => String(file.id) }),
		myChartScore: t.field({
			type: ChartScoreRef,
			nullable: true,
			resolve: async (file, _args, ctx) => {
				if (!ctx.user) return null;
				const chartId = file.id;
				// Prefer the request-scoped batch (populated by the connection
				// resolver when myChartScore is selected on a list). On a single
				// simfile(id) query there is no batch, so resolve individually and
				// memoize under the same cache.
				const cache = ctx.chartScoresCache ?? (ctx.chartScoresCache = new Map());
				const cached = cache.get(chartId);
				if (cached) return cached;
				const promise = getUserChartScore(ctx.db, ctx.user.id, chartId);
				cache.set(chartId, promise);
				return promise;
			}
		}),
		level: t.exposeFloat('level'),
		label: t.exposeString('label'),
		// Nullable + non-throwing: a missing R2 object for one level returns null
		// instead of an INTERNAL error, so the /preview query (the only consumer
		// that selects fileUrl) can filter that level out rather than null-
		// propagating and killing the entire chart. fileSizeBytes/fileEncoding
		// still throw (they are not selected by the preview query).
		fileUrl: t.string({
			nullable: true,
			resolve: async (file, _args, ctx) => {
				const chart = await findCatalogChart(ctx, file);
				if (!chart || chart.fileUrl === null) {
					ctx.logger.error('DTX chart file missing in R2', {
						simfileId: file.simfile.id,
						label: file.label,
						level: file.level
					});
					return null;
				}
				return chart.fileUrl;
			}
		}),
		fileSizeBytes: t.int({
			resolve: async (file, _args, ctx) =>
				(await requireCatalogChart(ctx, file)).fileSizeBytes
		}),
		fileEncoding: t.field({
			type: FileEncodingEnum,
			resolve: async (file, _args, ctx) => (await requireCatalogChart(ctx, file)).fileEncoding
		})
	})
});

const R2File = builder
	.objectRef<{ key: string; size: number; uploaded: string }>('R2File')
	.implement({
		fields: (t) => ({
			key: t.exposeString('key'),
			size: t.exposeInt('size'),
			uploaded: t.exposeString('uploaded')
		})
	});

export const SimfileRef = builder.objectRef<SimfileWithDtxFiles>('Simfile').implement({
	fields: (t) => ({
		id: t.id({ resolve: (s) => String(s.id) }),
		title: t.exposeString('title'),
		artist: t.exposeString('artist'),
		bpm: t.exposeFloat('bpm'),
		userId: t.id({ nullable: true, resolve: (s) => s.user_id ?? null }),
		isPublished: t.boolean({ resolve: (s) => s.is_published }),
		displayId: t.int({ nullable: true, resolve: (s) => s.display_id }),
		googleDriveFileId: t.string({
			nullable: true,
			resolve: (simfile, _args, ctx) =>
				ctx.user?.id === simfile.user_id ? (simfile.google_drive_file_id ?? null) : null
		}),
		downloadUrl: t.string({
			nullable: true,
			// Only return the user-set DB download_url when it is a genuine
			// external download link (e.g. Google Drive). See filterDownloadUrl
			// for why R2 bucket URLs are stripped (polluted by old resolver).
			// No R2 discovery fallback: the R2 download path is handled
			// separately via hasUploadedFiles + downloadSimfile(), gated by
			// the blog download feature flag.
			resolve: (s, _args, ctx) =>
				filterDownloadUrl(s.download_url, ctx.env.PUBLIC_SIMFILE_BUCKET_URL)
		}),
		previewUrl: t.string({
			nullable: true,
			resolve: async (s, _args, ctx) =>
				nonBlank(s.preview_url) ?? (await getCatalogDiscovery(ctx, s)).previewUrl
		}),
		videoPreviewUrl: t.string({ nullable: true, resolve: (s) => s.video_preview_url }),
		publishDate: t.string({ resolve: (s) => s.publish_date }),
		createdAt: t.string({ resolve: (s) => s.created_at }),
		updatedAt: t.string({ resolve: (s) => s.updated_at }),
		genre: t.string({ nullable: true, resolve: () => null }),
		tags: t.stringList({ resolve: () => [] }),
		durationSeconds: t.int({ nullable: true, resolve: () => null }),
		dtxFiles: t.field({
			type: [DtxFile],
			resolve: (s, _args, ctx) =>
				s.dtx_files
					.map((file, index) => ({ ...file, index, simfile: s }))
					.filter((file): file is DtxFileParent => {
						if (file.id == null) {
							ctx.logger.warn('DTX file row missing id, skipping', {
								simfileId: s.id
							});
							return false;
						}
						return true;
					})
		}),
		files: t.field({
			type: [R2File],
			resolve: async (s, _args, ctx) => {
				// Check request-scoped cache first (populated by connection-level
				// batch for list queries, or by a previous per-row call).
				const cached = ctx.filesCache.get(s.id);
				if (cached) {
					return cached;
				}
				// Single simfile query or cache miss: resolve individually.
				const promise = enrichFiles(ctx.r2, s.id);
				ctx.filesCache.set(s.id, promise);
				return promise;
			}
		}),
		hasUploadedFiles: t.boolean({
			resolve: async (s, _args, ctx) => {
				// Check request-scoped cache first (populated by connection-level
				// batch for list queries, or by a previous per-row call).
				const cached = ctx.hasUploadedFilesCache.get(s.id);
				if (cached) {
					try {
						return await cached;
					} catch {
						return false;
					}
				}
				// Single simfile query or cache miss: resolve individually.
				const promise = enrichHasUploadedFiles(ctx.r2, s.id).catch(() => false);
				ctx.hasUploadedFilesCache.set(s.id, promise);
				return promise;
			}
		})
	})
});

export const SimfileConnectionRef = builder
	.objectRef<{ data: SimfileWithDtxFiles[]; count: number }>('SimfileConnection')
	.implement({
		fields: (t) => ({
			data: t.field({
				type: [SimfileRef],
				resolve: async (c, _args, ctx, info) => {
					if (c.data.length > 0) {
						const ids = c.data.map((s) => s.id);

						// Only batch-enrich hasUploadedFiles when the client selected it.
						if (isFieldSelected(info, 'hasUploadedFiles')) {
							const batchPromise = batchEnrichHasUploadedFiles(ctx.r2, ids);
							for (const s of c.data) {
								ctx.hasUploadedFilesCache.set(
									s.id,
									batchPromise.then((map) => map.get(s.id) ?? false)
								);
							}
						}

						// Only batch-enrich files when the client selected it.
						if (isFieldSelected(info, 'files')) {
							const filesBatchPromise = batchEnrichFiles(ctx.r2, ids);
							for (const s of c.data) {
								ctx.filesCache.set(
									s.id,
									filesBatchPromise.then((map) => map.get(s.id) ?? [])
								);
							}
						}

						const previewSelected = isFieldSelected(info, 'previewUrl');
						const dtxSelected = isNestedFieldSelected(info, 'dtxFiles', [
							'fileUrl',
							'fileSizeBytes',
							'fileEncoding'
						]);

						// Per-sim filter: only sims that actually need R2 discovery are passed
						// to the batch. Sims whose selected catalog-backed fields all have
						// non-blank DB values skip discovery entirely — their resolvers
						// short-circuit at nonBlank(...) before ever consulting the cache.
						// downloadUrl is DB-only (no discovery fallback), so it never
						// triggers discovery here.
						const simsNeedingDiscovery = c.data.filter((s) => {
							if (previewSelected && nonBlank(s.preview_url) == null) return true;
							if (dtxSelected) return true;
							return false;
						});

						if (simsNeedingDiscovery.length > 0) {
							const catalogBatchPromise = batchDiscoverCatalogFiles(
								ctx.r2,
								simsNeedingDiscovery.map((s) => ({
									simfileId: s.id,
									// When the client didn't select any dtxFiles fields,
									// pass an empty array so discoverCatalogFiles skips
									// the SET.DEF fetch and chart matching. The result is
									// cached with chartsPopulated: false; chart resolvers
									// detect this and re-discover on demand.
									dtxFiles: dtxSelected ? s.dtx_files : [],
									publicBaseUrl: ctx.env.PUBLIC_SIMFILE_BUCKET_URL
								})),
								ctx.logger
							);
							const cache =
								ctx.catalogFilesCache ?? (ctx.catalogFilesCache = new Map());
							for (const s of simsNeedingDiscovery) {
								cache.set(
									s.id,
									catalogBatchPromise.then(
										(map) =>
											map.get(s.id) ?? {
												previewUrl: null,
												downloadUrl: null,
												charts: [],
												chartsPopulated: false
											}
									)
								);
							}
							// Intentionally do NOT populate cache entries for sims that
							// skipped discovery. Writing partial entries (DB URLs only,
							// charts: []) would poison the request-scoped cache: if the
							// same simfile is reached via another resolver path in this
							// document that selects a catalog field the list path did not
							// (e.g. an aliased `simfile(id)` query alongside the list), the
							// field resolver would short-circuit on the partial entry and
							// return a stale null/empty value instead of discovering R2.
							// A cache miss in getCatalogDiscovery correctly falls through
							// to single-sim discovery, and resolvers for skipped sims
							// short-circuit at nonBlank(...) before ever consulting the
							// cache, so leaving them uncached has no cost in normal flow.
						}

						// Batch-load the caller's chart scores when myChartScore is selected,
						// so a scored-simfiles page issues 2 D1 queries total instead of 2 per
						// chart. Mirrors the hasUploadedFiles / files batch pattern above.
						if (ctx.user && isNestedFieldSelected(info, 'dtxFiles', ['myChartScore'])) {
							const chartIds = c.data.flatMap((s) =>
								s.dtx_files
									.map((d) => d.id)
									.filter((id): id is number => id != null)
							);
							if (chartIds.length > 0) {
								const cache =
									ctx.chartScoresCache ?? (ctx.chartScoresCache = new Map());
								const batchPromise = listUserChartScores(
									ctx.db,
									ctx.user.id,
									chartIds
								);
								for (const chartId of chartIds) {
									cache.set(
										chartId,
										batchPromise.then((map) => map.get(chartId) ?? null)
									);
								}
							}
						}
					}
					return c.data;
				}
			}),
			count: t.exposeInt('count')
		})
	});

export const SimfileSearchResultRef = builder
	.objectRef<{
		id: number;
		title: string;
		artist: string;
		bpm: number;
		is_published: 0 | 1;
	}>('SimfileSearchResult')
	.implement({
		fields: (t) => ({
			id: t.id({ resolve: (s) => String(s.id) }),
			title: t.exposeString('title'),
			artist: t.exposeString('artist'),
			bpm: t.exposeFloat('bpm'),
			isPublished: t.boolean({ resolve: (s) => s.is_published === 1 })
		})
	});

export const DeleteResultRef = builder
	.objectRef<{
		id: string;
		deleted: boolean;
		partialDeletion?: boolean;
		message?: string;
	}>('DeleteResult')
	.implement({
		fields: (t) => ({
			id: t.exposeID('id'),
			deleted: t.exposeBoolean('deleted'),
			partialDeletion: t.exposeBoolean('partialDeletion', { nullable: true }),
			message: t.exposeString('message', { nullable: true })
		})
	});

// --- input types (registered now; consumers added in later tasks) ---

export const DtxFileInput = builder.inputType('DtxFileInput', {
	fields: (t) => ({
		label: t.string({ required: true }),
		level: t.float({ required: true })
	})
});

export const CreateSimfileInput = builder.inputType('CreateSimfileInput', {
	fields: (t) => ({
		title: t.string({ required: false }),
		artist: t.string({ required: false }),
		bpm: t.float({ required: true }),
		isPublished: t.boolean({ required: false }),
		displayId: t.int({ required: false }),
		downloadUrl: t.string({ required: false }),
		previewUrl: t.string({ required: false }),
		videoPreviewUrl: t.string({ required: false }),
		publishDate: t.string({ required: false }),
		dtxFiles: t.field({ type: [DtxFileInput], required: false })
	})
});

export const UpdateSimfileInput = builder.inputType('UpdateSimfileInput', {
	fields: (t) => ({
		title: t.string({ required: false }),
		artist: t.string({ required: false }),
		bpm: t.float({ required: false }),
		isPublished: t.boolean({ required: false }),
		displayId: t.int({ required: false }),
		downloadUrl: t.string({ required: false }),
		previewUrl: t.string({ required: false }),
		videoPreviewUrl: t.string({ required: false }),
		publishDate: t.string({ required: false })
	})
});

// --- Query.simfile ---

builder.queryField('simfile', (t) =>
	t.field({
		type: SimfileRef,
		nullable: true,
		args: { id: t.arg.id({ required: true }) },
		authScopes: (_root, args) => ({ publicOrOwner: { simfileId: String(args.id) } }),
		resolve: async (_root, { id }, ctx) => {
			const numeric = Number(id);
			if (!Number.isSafeInteger(numeric)) {
				throw new GraphQLError('Invalid simfile id', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}
			const row = await getSimfile(ctx.db, numeric);
			if (!row) return null;
			// Defense-in-depth: re-verify visibility after fetch.  If the
			// simfile was inserted between the publicOrOwner scope check and
			// here (scope passed because the row was missing), enforce the
			// same is_published / ownership rules on the actual row.
			if (!row.is_published && row.user_id !== ctx.user?.id) {
				return null;
			}
			return row;
		}
	})
);

// --- Query.nextDisplayId ---

builder.queryField('nextDisplayId', (t) =>
	t.int({
		authScopes: { user: true },
		resolve: async (_root, _args, ctx) => getNextDisplayId(ctx.db, ctx.user!.id)
	})
);

// --- Query.simfiles ---

builder.queryField('simfiles', (t) =>
	t.field({
		type: SimfileConnectionRef,
		args: {
			scope: t.arg({ type: SimfileScopeEnum, required: true }),
			search: t.arg.string({ required: false }),
			page: t.arg.int({ required: false, defaultValue: 1 }),
			pageSize: t.arg.int({ required: false, defaultValue: 20 })
		},
		resolve: async (_root, args, ctx) => {
			if (args.scope === 'MINE' && !ctx.user) {
				throw new GraphQLError('Authentication required for scope MINE', {
					extensions: { code: 'UNAUTHORIZED' }
				});
			}
			return listSimfiles(ctx.db, {
				userId: args.scope === 'MINE' ? ctx.user!.id : undefined,
				publishedOnly: args.scope === 'PUBLISHED',
				search: args.search ?? undefined,
				page: args.page ?? 1, // defaultValue may not narrow to non-null in this Pothos version
				pageSize: args.pageSize ?? 20 // defaultValue may not narrow to non-null in this Pothos version
			});
		}
	})
);

// --- Query.myScoredSimfiles ---

builder.queryField('myScoredSimfiles', (t) =>
	t.field({
		type: SimfileConnectionRef,
		args: {
			page: t.arg.int({ required: false, defaultValue: 1 }),
			pageSize: t.arg.int({ required: false, defaultValue: 20 })
		},
		authScopes: { user: true },
		resolve: async (_root, args, ctx) =>
			listUserScoredSimfiles(ctx.db, {
				userId: ctx.user!.id,
				page: args.page ?? 1,
				pageSize: args.pageSize ?? 20
			})
	})
);

// --- Query.simfileSearch ---

builder.queryField('simfileSearch', (t) =>
	t.field({
		type: [SimfileSearchResultRef],
		args: {
			query: t.arg.string({ required: true }),
			excludeIds: t.arg.idList({ required: false }),
			limit: t.arg.int({ required: false, defaultValue: 8 })
		},
		authScopes: { user: true },
		resolve: async (_root, args, ctx) => {
			const trimmed = args.query.trim();
			if (!trimmed) return [];
			const excludeIds = (args.excludeIds ?? [])
				.map((id) => Number(id))
				.filter((n) => Number.isSafeInteger(n) && n > 0);
			return searchSimfiles(ctx.db, {
				query: trimmed,
				userId: ctx.user!.id,
				excludeIds,
				limit: args.limit ?? 8 // defaultValue may not narrow to non-null in this Pothos version
			});
		}
	})
);

// --- Mutation.createSimfile ---

builder.mutationField('createSimfile', (t) =>
	t.field({
		type: SimfileRef,
		args: { input: t.arg({ type: CreateSimfileInput, required: true }) },
		authScopes: { user: true },
		resolve: async (_root, { input }, ctx) => {
			if (!Number.isFinite(input.bpm)) {
				throw new GraphQLError('Invalid bpm', { extensions: { code: 'BAD_USER_INPUT' } });
			}
			if (input.publishDate != null && Number.isNaN(Date.parse(input.publishDate))) {
				throw new GraphQLError('Invalid publishDate', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}

			const { simfile, dtxFiles } = await createSimfileWithDtx(ctx.db, {
				userId: ctx.user!.id,
				title: input.title ?? '',
				artist: input.artist ?? '',
				bpm: input.bpm,
				isPublished: input.isPublished ?? false,
				displayId: input.displayId ?? null,
				downloadUrl: filterDownloadUrl(
					input.downloadUrl,
					ctx.env.PUBLIC_SIMFILE_BUCKET_URL
				),
				previewUrl: input.previewUrl ?? null,
				videoPreviewUrl: input.videoPreviewUrl ?? null,
				publishDate: input.publishDate ?? undefined,
				dtxFiles: (input.dtxFiles ?? []).map((f) => ({ label: f.label, level: f.level }))
			});

			return toSimfileWithDtx(simfile, dtxFiles);
		}
	})
);

// --- Mutation.updateSimfileDriveFile ---

builder.mutationField('updateSimfileDriveFile', (t) =>
	t.field({
		type: SimfileRef,
		args: {
			id: t.arg.id({ required: true }),
			googleDriveFileId: t.arg.string({ required: true }),
			downloadUrl: t.arg.string({ required: true }),
			expectedPreviousDriveFileId: t.arg.string({ required: false }),
			expectNoExistingDriveFile: t.arg.boolean({ required: false })
		},
		authScopes: (_root, args) => ({ owner: { simfileId: String(args.id) } }),
		resolve: async (
			_root,
			{
				id,
				googleDriveFileId,
				downloadUrl,
				expectedPreviousDriveFileId,
				expectNoExistingDriveFile
			},
			ctx
		) => {
			const numeric = Number(id);
			if (!Number.isSafeInteger(numeric)) {
				throw new GraphQLError('Invalid simfile id', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}

			const existing = await getSimfile(ctx.db, numeric);
			if (!existing) {
				throw new GraphQLError('Simfile not found', {
					extensions: { code: 'NOT_FOUND' }
				});
			}
			if (existing.user_id !== ctx.user!.id) {
				throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
			}

			const normalizedDriveFileId = normalizeGoogleDriveFileId(googleDriveFileId);
			const normalizedDownloadUrl = normalizeGoogleDriveDownloadUrl(
				downloadUrl,
				ctx.env.PUBLIC_SIMFILE_BUCKET_URL
			);

			try {
				await updateSimfileDriveFile(ctx.db, numeric, ctx.user!.id, {
					googleDriveFileId: normalizedDriveFileId,
					downloadUrl: normalizedDownloadUrl,
					expectedPreviousDriveFileId: expectedPreviousDriveFileId ?? undefined,
					expectNoExistingDriveFile: expectNoExistingDriveFile ?? undefined
				});
			} catch (error) {
				if (error instanceof Error && error.message.includes('not found')) {
					throw new GraphQLError('Simfile not found', {
						extensions: { code: 'NOT_FOUND' }
					});
				}
				throw error;
			}

			const full = await getSimfile(ctx.db, numeric);
			if (!full) {
				throw new GraphQLError('Simfile not found', {
					extensions: { code: 'NOT_FOUND' }
				});
			}
			return full;
		}
	})
);

// --- Mutation.updateSimfile ---

builder.mutationField('updateSimfile', (t) =>
	t.field({
		type: SimfileRef,
		args: {
			id: t.arg.id({ required: true }),
			input: t.arg({ type: UpdateSimfileInput, required: true })
		},
		authScopes: (_root, args) => ({ owner: { simfileId: String(args.id) } }),
		resolve: async (_root, { id, input }, ctx) => {
			const numeric = Number(id);
			if (!Number.isSafeInteger(numeric)) {
				throw new GraphQLError('Invalid simfile id', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}

			// Defense-in-depth: re-verify the row exists and belongs to the
			// authenticated user.  The owner scope intentionally passes for
			// missing simfiles so the resolver can return NOT_FOUND, but that
			// opens a theoretical TOCTOU window.  Re-reading the row here
			// closes it.
			const existing = await getSimfile(ctx.db, numeric);
			if (!existing) {
				throw new GraphQLError('Simfile not found', {
					extensions: { code: 'NOT_FOUND' }
				});
			}
			if (existing.user_id !== ctx.user!.id) {
				throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
			}

			const updateData: Record<string, unknown> = {};
			if (input.title != null) updateData.title = input.title;
			if (input.artist != null) updateData.artist = input.artist;
			if (input.bpm != null) {
				if (!Number.isFinite(input.bpm)) {
					throw new GraphQLError('Invalid bpm', {
						extensions: { code: 'BAD_USER_INPUT' }
					});
				}
				updateData.bpm = input.bpm;
			}
			if (input.isPublished != null) updateData.is_published = input.isPublished ? 1 : 0;
			if (input.displayId !== undefined) updateData.display_id = input.displayId;
			if (input.downloadUrl !== undefined)
				updateData.download_url = filterDownloadUrl(
					input.downloadUrl,
					ctx.env.PUBLIC_SIMFILE_BUCKET_URL
				);
			if (input.previewUrl !== undefined) updateData.preview_url = input.previewUrl;
			if (input.videoPreviewUrl !== undefined)
				updateData.video_preview_url = input.videoPreviewUrl;
			if (input.publishDate != null) {
				if (Number.isNaN(Date.parse(input.publishDate))) {
					throw new GraphQLError('Invalid publishDate', {
						extensions: { code: 'BAD_USER_INPUT' }
					});
				}
				updateData.publish_date = input.publishDate;
			}

			if (Object.keys(updateData).length === 0) {
				throw new GraphQLError('No fields to update', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}

			try {
				const updatedRow = await updateSimfile(ctx.db, numeric, updateData);
				// Re-read to get the joined DTX files; fall back to the authoritative
				// RETURNING * row if the simfile is concurrently deleted between
				// update and read (avoids a false NOT_FOUND on a successful update).
				const full = await getSimfile(ctx.db, numeric);
				return full ?? toSimfileWithDtx(updatedRow, []);
			} catch (err) {
				if (err instanceof Error && err.message.includes('not found')) {
					throw new GraphQLError('Simfile not found', {
						extensions: { code: 'NOT_FOUND' }
					});
				}
				throw err;
			}
		}
	})
);

// --- Mutation.deleteSimfile ---

builder.mutationField('deleteSimfile', (t) =>
	t.field({
		type: DeleteResultRef,
		args: { id: t.arg.id({ required: true }) },
		authScopes: (_root, args) => ({ owner: { simfileId: String(args.id) } }),
		resolve: async (_root, { id }, ctx) => {
			const numeric = Number(id);
			if (!Number.isSafeInteger(numeric)) {
				throw new GraphQLError('Invalid simfile id', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}

			// Verify the DB row exists AND belongs to the caller before
			// touching R2 objects.  The owner scope intentionally passes for
			// missing simfiles so the resolver can return NOT_FOUND, but that
			// opens a theoretical TOCTOU window.  Re-reading here closes it
			// and ensures we never act on a row the user doesn't own.
			const existing = await getSimfile(ctx.db, numeric);
			if (!existing) {
				throw new GraphQLError('Simfile not found', {
					extensions: { code: 'NOT_FOUND' }
				});
			}
			if (existing.user_id !== ctx.user!.id) {
				throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
			}

			// Port of dtx-web's cursor-paginated R2 list+delete.
			// Hard cap iterations so a misbehaving R2 (or test mock) can't loop us
			// into the Worker CPU limit; 1000 pages × 1000 keys = 1M objects max.
			// Phase 1: collect all keys before deleting anything so a later list
			// failure doesn't leave a partially-deleted prefix with a live DB row.
			const MAX_PAGES = 1000;
			let cursor: string | undefined;
			let truncated = true;
			let pages = 0;
			const allKeys: string[] = [];
			while (truncated) {
				if (++pages > MAX_PAGES) {
					ctx.logger.error('R2 pagination exceeded MAX_PAGES while deleting', {
						simfileId: numeric
					});
					throw new GraphQLError('Failed to list all files for deletion', {
						extensions: { code: 'INTERNAL' }
					});
				}
				let listResult;
				try {
					listResult = await ctx.r2.list({
						prefix: `${numeric}/`,
						limit: 1000,
						cursor
					});
				} catch (err) {
					ctx.logger.error('R2 list failed while deleting', {
						simfileId: numeric,
						error: err instanceof Error ? err.message : String(err)
					});
					throw new GraphQLError('Failed to list files for deletion', {
						extensions: { code: 'INTERNAL' }
					});
				}
				const objects = listResult.objects ?? [];
				for (const obj of objects) {
					allKeys.push(obj.key);
				}
				truncated = listResult.truncated === true;
				if (truncated) {
					const nextCursor = (listResult as { cursor?: string }).cursor;
					if (!nextCursor || nextCursor === cursor) {
						ctx.logger.error('R2 pagination stalled while deleting', {
							simfileId: numeric
						});
						throw new GraphQLError('Failed to list all files for deletion', {
							extensions: { code: 'INTERNAL' }
						});
					}
					cursor = nextCursor;
				}
			}

			// Phase 2: delete collected keys in bounded chunks to avoid exhausting
			// Worker memory or R2 subrequest concurrency. Log failures but always
			// remove the DB row — a simfile with missing backing files is worse
			// than a clean delete.
			const DELETE_CHUNK_SIZE = 50;
			const allFailures: string[] = [];
			for (let i = 0; i < allKeys.length; i += DELETE_CHUNK_SIZE) {
				const chunk = allKeys.slice(i, i + DELETE_CHUNK_SIZE);
				const results = await Promise.allSettled(chunk.map((key) => ctx.r2.delete(key)));
				const failed = results
					.map((r, j) => (r.status === 'rejected' ? chunk[j] : null))
					.filter((k): k is string => k !== null);
				allFailures.push(...failed);
			}
			if (allFailures.length > 0) {
				ctx.logger.error('R2 delete failed for some objects while deleting simfile', {
					simfileId: numeric,
					failedKeys: allFailures
				});
			}

			try {
				await deleteSimfile(ctx.db, numeric);
			} catch (err) {
				if (err instanceof Error && err.message.includes('not found')) {
					throw new GraphQLError('Simfile not found', {
						extensions: { code: 'NOT_FOUND' }
					});
				}
				throw err;
			}

			return {
				id: String(numeric),
				deleted: true,
				partialDeletion: allFailures.length > 0 ? true : undefined,
				message:
					allFailures.length > 0
						? `${allFailures.length} file(s) could not be deleted from storage`
						: undefined
			};
		}
	})
);
