import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../context';
import { makeCtx, runQuery } from './simfileTestHarness';

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

const { getSimfile, getSimfileOwner, updateSimfileDriveFile } = await import('@dtx/common/server');
const mockedGetSimfile = vi.mocked(getSimfile);
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedUpdateDriveFile = vi.mocked(updateSimfileDriveFile);

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
		// The unexpected failure must surface unchanged — neither relabeled
		// as NOT_FOUND (the "not found" substring is absent) nor FORBIDDEN.
		expect(result.errors?.[0]?.message).toBe('database unavailable');
		expect(result.errors?.[0]?.extensions?.code).not.toBe('NOT_FOUND');
		expect(result.errors?.[0]?.extensions?.code).not.toBe('FORBIDDEN');
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

	it('returns DRIVE_BINDING_MISMATCH when the optimistic-concurrency guard fails', async () => {
		mockedGetSimfile.mockResolvedValue(ownedSimfile);
		mockedUpdateDriveFile.mockRejectedValue(new Error('Drive binding mismatch'));

		const result = await executeUpdate(makeCtx({ user: { id: 'u1' } as Ctx['user'] }));

		expect(result.errors?.[0]?.extensions?.code).toBe('DRIVE_BINDING_MISMATCH');
		expect(result.errors?.[0]?.message).toContain('Drive binding changed');
		expect(mockedUpdateDriveFile).toHaveBeenCalledOnce();
	});
});
