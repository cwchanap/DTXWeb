import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSimfileWithDtx } from './createSimfile';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		createSimfile: vi.fn(),
		createDtxFiles: vi.fn(),
		deleteSimfile: vi.fn()
	};
});

const { createSimfile, createDtxFiles, deleteSimfile } = await import('@dtx/common/server');
const mockedCreate = vi.mocked(createSimfile);
const mockedCreateDtx = vi.mocked(createDtxFiles);
const mockedDelete = vi.mocked(deleteSimfile);

beforeEach(() => {
	mockedCreate.mockReset();
	mockedCreateDtx.mockReset();
	mockedDelete.mockReset();
});

const baseArgs = {
	userId: 'u1',
	title: 'T',
	artist: 'A',
	bpm: 120,
	isPublished: false,
	displayId: null,
	downloadUrl: null,
	previewUrl: null,
	videoPreviewUrl: null,
	dtxFiles: [] as { label: string; level: number }[]
};

const baseRow = {
	id: 7,
	title: 'T',
	artist: 'A',
	bpm: 120,
	user_id: 'u1',
	is_published: 0 as const,
	display_id: 1,
	download_url: null,
	preview_url: null,
	video_preview_url: null,
	publish_date: '2026-05-19T00:00:00Z',
	created_at: '2026-05-19T00:00:00Z',
	updated_at: '2026-05-19T00:00:00Z'
};

describe('createSimfileWithDtx', () => {
	it('creates a simfile with no dtxFiles', async () => {
		mockedCreate.mockResolvedValue(baseRow);
		const result = await createSimfileWithDtx({} as never, baseArgs);
		expect(result.simfile).toEqual(baseRow);
		expect(result.dtxFiles).toEqual([]);
		expect(mockedCreateDtx).not.toHaveBeenCalled();
	});

	it('creates a simfile and its dtxFiles', async () => {
		mockedCreate.mockResolvedValue(baseRow);
		mockedCreateDtx.mockResolvedValue([
			{ id: 1, label: 'BSC', level: 5.5, simfile_id: 7 },
			{ id: 2, label: 'ADV', level: 7.5, simfile_id: 7 }
		]);
		const result = await createSimfileWithDtx({} as never, {
			...baseArgs,
			dtxFiles: [
				{ label: 'BSC', level: 5.5 },
				{ label: 'ADV', level: 7.5 }
			]
		});
		expect(result.dtxFiles).toEqual([
			{ id: 1, label: 'BSC', level: 5.5 },
			{ id: 2, label: 'ADV', level: 7.5 }
		]);
		expect(mockedCreateDtx).toHaveBeenCalledWith(expect.anything(), [
			{ label: 'BSC', level: 5.5, simfile_id: 7 },
			{ label: 'ADV', level: 7.5, simfile_id: 7 }
		]);
	});

	it('rolls back the simfile row when createDtxFiles throws', async () => {
		mockedCreate.mockResolvedValue(baseRow);
		mockedCreateDtx.mockRejectedValue(new Error('dtx insert failed'));
		mockedDelete.mockResolvedValue(undefined as never);
		await expect(
			createSimfileWithDtx({} as never, {
				...baseArgs,
				dtxFiles: [{ label: 'BSC', level: 5.5 }]
			})
		).rejects.toThrow('dtx insert failed');
		expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), 7);
	});

	it('swallows rollback failures', async () => {
		mockedCreate.mockResolvedValue(baseRow);
		mockedCreateDtx.mockRejectedValue(new Error('dtx insert failed'));
		mockedDelete.mockRejectedValue(new Error('rollback also failed'));
		await expect(
			createSimfileWithDtx({} as never, {
				...baseArgs,
				dtxFiles: [{ label: 'BSC', level: 5.5 }]
			})
		).rejects.toThrow('dtx insert failed');
		expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), 7);
	});

	it('passes bare 1–9 levels through unchanged (raw #DLEVEL is already canonical)', async () => {
		// The raw #DLEVEL value is stored directly — it is already in
		// DTXManiaCX's canonical encoding (≥100 = hundredths, <100 = tenths).
		// A bare 5 decodes as 0.50 via the ×10 branch, which is a valid
		// sub-1.0 level. No encoding or normalization is applied at the
		// API boundary.
		mockedCreate.mockResolvedValue(baseRow);
		mockedCreateDtx.mockResolvedValue([
			{ id: 1, label: 'BSC', level: 5, simfile_id: 7 },
			{ id: 2, label: 'ADV', level: 9, simfile_id: 7 }
		]);
		const result = await createSimfileWithDtx({} as never, {
			...baseArgs,
			dtxFiles: [
				{ label: 'BSC', level: 5 },
				{ label: 'ADV', level: 9 }
			]
		});
		expect(mockedCreateDtx).toHaveBeenCalledWith(expect.anything(), [
			{ label: 'BSC', level: 5, simfile_id: 7 },
			{ label: 'ADV', level: 9, simfile_id: 7 }
		]);
		expect(result.dtxFiles).toEqual([
			{ id: 1, label: 'BSC', level: 5 },
			{ id: 2, label: 'ADV', level: 9 }
		]);
	});

	it('passes all level values through unchanged', async () => {
		mockedCreate.mockResolvedValue(baseRow);
		mockedCreateDtx.mockResolvedValue([
			{ id: 1, label: 'BSC', level: 55, simfile_id: 7 },
			{ id: 2, label: 'ADV', level: 0, simfile_id: 7 },
			{ id: 3, label: 'EXT', level: 5.5, simfile_id: 7 }
		]);
		await createSimfileWithDtx({} as never, {
			...baseArgs,
			dtxFiles: [
				{ label: 'BSC', level: 55 },
				{ label: 'ADV', level: 0 },
				{ label: 'EXT', level: 5.5 }
			]
		});
		expect(mockedCreateDtx).toHaveBeenCalledWith(expect.anything(), [
			{ label: 'BSC', level: 55, simfile_id: 7 },
			{ label: 'ADV', level: 0, simfile_id: 7 },
			{ label: 'EXT', level: 5.5, simfile_id: 7 }
		]);
	});
});
