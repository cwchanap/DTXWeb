import { GraphQLError } from 'graphql';
import {
	getSimfile,
	getNextDisplayId,
	listSimfiles,
	searchSimfiles,
	toSimfileWithDtx,
	type SimfileWithDtxFiles
} from '@dtx/common/server';
import { builder } from './builder';
import { enrichFiles, enrichHasUploadedFiles } from '../services/r2Enrichment';
import { createSimfileWithDtx } from '../services/createSimfile';

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
		dtxFiles: t.field({ type: [DtxFile], resolve: (s) => s.dtx_files }),
		files: t.field({
			type: [R2File],
			resolve: (s, _args, ctx) => enrichFiles(ctx.r2, s.id)
		}),
		hasUploadedFiles: t.boolean({
			resolve: (s, _args, ctx) => enrichHasUploadedFiles(ctx.r2, s.id)
		})
	})
});

export const SimfileConnectionRef = builder
	.objectRef<{ data: SimfileWithDtxFiles[]; count: number }>('SimfileConnection')
	.implement({
		fields: (t) => ({
			data: t.field({ type: [SimfileRef], resolve: (c) => c.data }),
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
	.objectRef<{ id: string; deleted: boolean }>('DeleteResult')
	.implement({
		fields: (t) => ({
			id: t.exposeID('id'),
			deleted: t.exposeBoolean('deleted')
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
			return getSimfile(ctx.db, numeric);
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
			const excludeIds = (args.excludeIds ?? [])
				.map((id) => Number(id))
				.filter((n) => Number.isSafeInteger(n) && n > 0);
			return searchSimfiles(ctx.db, {
				query: args.query,
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
			if (input.displayId != null && !Number.isSafeInteger(input.displayId)) {
				throw new GraphQLError('Invalid displayId', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
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
				videoPreviewUrl: input.videoPreviewUrl ?? null,
				publishDate: input.publishDate ?? undefined,
				dtxFiles: (input.dtxFiles ?? []).map((f) => ({ label: f.label, level: f.level }))
			});

			return toSimfileWithDtx(simfile, dtxFiles);
		}
	})
);
