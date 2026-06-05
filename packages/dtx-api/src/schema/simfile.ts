import { GraphQLError, type GraphQLResolveInfo, type SelectionNode } from 'graphql';
import {
	getSimfile,
	getNextDisplayId,
	listSimfiles,
	searchSimfiles,
	toSimfileWithDtx,
	updateSimfile,
	deleteSimfile,
	type SimfileWithDtxFiles
} from '@dtx/common/server';
import { builder } from './builder';
import {
	enrichFiles,
	enrichHasUploadedFiles,
	batchEnrichHasUploadedFiles,
	batchEnrichFiles
} from '../services/r2Enrichment';
import { createSimfileWithDtx } from '../services/createSimfile';

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

// --- enums ---

export const SimfileScopeEnum = builder.enumType('SimfileScope', {
	values: ['MINE', 'PUBLISHED'] as const
});

// --- object types ---

const DtxFile = builder.objectRef<{ level: number; label: string }>('DtxFile').implement({
	fields: (t) => ({
		level: t.exposeFloat('level'),
		label: t.exposeString('label')
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
		downloadUrl: t.string({ nullable: true, resolve: (s) => s.download_url }),
		previewUrl: t.string({ nullable: true, resolve: (s) => s.preview_url }),
		videoPreviewUrl: t.string({ nullable: true, resolve: (s) => s.video_preview_url }),
		publishDate: t.string({ resolve: (s) => s.publish_date }),
		createdAt: t.string({ resolve: (s) => s.created_at }),
		updatedAt: t.string({ resolve: (s) => s.updated_at }),
		genre: t.string({ nullable: true, resolve: () => null }),
		tags: t.stringList({ resolve: () => [] }),
		durationSeconds: t.int({ nullable: true, resolve: () => null }),
		dtxFiles: t.field({ type: [DtxFile], resolve: (s) => s.dtx_files }),
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
				downloadUrl: input.downloadUrl ?? null,
				previewUrl: input.previewUrl ?? null,
				videoPreviewUrl: input.videoPreviewUrl ?? null,
				publishDate: input.publishDate ?? undefined,
				dtxFiles: (input.dtxFiles ?? []).map((f) => ({ label: f.label, level: f.level }))
			});

			return toSimfileWithDtx(simfile, dtxFiles);
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
			if (input.downloadUrl !== undefined) updateData.download_url = input.downloadUrl;
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
