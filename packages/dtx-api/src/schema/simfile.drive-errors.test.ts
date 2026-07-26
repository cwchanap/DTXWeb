import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfile: vi.fn(),
		getSimfileOwner: vi.fn(),
		updateSimfileDriveFile: vi.fn()
	};
});

const { schema } = await import('./index');
const { getSimfile, getSimfileOwner, updateSimfileDriveFile } = await import('@dtx/common/server');
const mockedGetSimfile = vi.mocked(getSimfile);
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedUpdateDriveFile = vi.mocked(updateSimfileDriveFile);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: ''
});

const makeCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
	user: null,
	session: null,
	env: makeEnv(),
	db: {} as Ctx['db'],
	r2: {} as Ctx['r2'],
	kv: {} as Ctx['kv'],
	request: new Request('http://test'),
	logger: workerLogger,
	ownerByIdCache: new Map(),
	hasUploadedFilesCache: new Map(),
	filesCache: new Map(),
	catalogFilesCache: new Map(),
	...overrides
});

const runQuery = async (ctx: Ctx, body: Record<string, unknown>) => {
	const yoga = createYoga<{ ctx: Ctx }>({
		schema,
		context: (req) => req.ctx,
		maskedErrors: false,
		cors: false,
		landingPage: false
	});
	const response = await yoga.fetch(
		'http://test/graphql',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		},
		{ ctx }
	);
	return response.json() as Promise<{
		data?: Record<string, unknown> | null;
		errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
	}>;
};

const ownedSimfile = {
	id: 42,
	title: 'Song A',
	artist: 'Artist A',
	bpm: 120,
	user_id: 'u1',
	is_published: false as const,
	display_id: 1,
	download_url: 'https://drive.google.com/old',
	google_drive_file_id: 'old-drive-file',
	preview_url: null,
	video_preview_url: null,
	publish_date: '2026-05-19T00:00:00Z',
	created_at: '2026-05-19T00:00:00Z',
	updated_at: '2026-05-19T00:00:00Z',
	dtx_files: []
};

const mutation = `mutation UpdateDrive(
	$id: ID!
	$googleDriveFileId: String!
	$downloadUrl: String!
) {
	updateSimfileDriveFile(
		id: $id
		googleDriveFileId: $googleDriveFileId
		downloadUrl: $downloadUrl
	) { id }
}`;

const executeUpdate = (
	ctx: Ctx,
	overrides: Partial<{ id: string; googleDriveFileId: string; downloadUrl: string }> = {}
) =>
	runQuery(ctx, {
		query: mutation,
		variables: {
			id: '42',
			googleDriveFileId: 'drive-file-123',
			downloadUrl: 'https://drive.google.com/uc?id=drive-file-123',
			...overrides
		}
	});

describe('Mutation.updateSimfileDriveFile error paths', () => {
	beforeEach(() => {
		mockedGetSimfile.mockReset();
		mockedGetOwner.mockReset();
		mockedUpdateDriveFile.mockReset();
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
	});

	it('rejects an unsafe simfile id before querying or updating', async () => {
		const result = await executeUpdate(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			id: 'not-a-number'
		});

		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
		expect(mockedGetSimfile).not.toHaveBeenCalled();
		expect(mockedUpdateDriveFile).not.toHaveBeenCalled();
	});

	it('returns NOT_FOUND when the simfile disappears before the ownership recheck', async () => {
		mockedGetSimfile.mockResolvedValue(null);

		const result = await executeUpdate(makeCtx({ user: { id: 'u1' } as Ctx['user'] }));

		expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
		expect(mockedUpdateDriveFile).not.toHaveBeenCalled();
	});

	it('rejects a malformed download URL', async () => {
		mockedGetSimfile.mockResolvedValue(ownedSimfile);

		const result = await executeUpdate(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			downloadUrl: 'not a URL'
		});

		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
		expect(mockedUpdateDriveFile).not.toHaveBeenCalled();
	});

	it('propagates unexpected atomic update errors', async () => {
		mockedGetSimfile.mockResolvedValue(ownedSimfile);
		mockedUpdateDriveFile.mockRejectedValue(new Error('database unavailable'));

		const result = await executeUpdate(makeCtx({ user: { id: 'u1' } as Ctx['user'] }));

		expect(result.errors).toHaveLength(1);
		expect(mockedUpdateDriveFile).toHaveBeenCalledOnce();
	});

	it('returns NOT_FOUND when the simfile disappears after the atomic update', async () => {
		mockedGetSimfile.mockResolvedValueOnce(ownedSimfile).mockResolvedValueOnce(null);
		mockedUpdateDriveFile.mockResolvedValue(
			{} as Awaited<ReturnType<typeof updateSimfileDriveFile>>
		);

		const result = await executeUpdate(makeCtx({ user: { id: 'u1' } as Ctx['user'] }));

		expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
		expect(mockedUpdateDriveFile).toHaveBeenCalledOnce();
	});
});
