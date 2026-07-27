import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, requestMock } = vi.hoisted(() => {
	const mockEnv = { PUBLIC_DTX_API_URL: 'https://api.test' };
	const requestMock = vi.fn();
	return { mockEnv, requestMock };
});

vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token'),
	getAccessToken: vi.fn().mockResolvedValue('test-token')
}));

vi.mock('./transport', () => ({
	makeBrowserClient: () => ({ request: requestMock, url: 'x', requestConfig: { headers: {} } }),
	makeServiceBindingClient: () => ({ request: requestMock })
}));

import {
	listSimfiles,
	getSimfile,
	updateSimfile,
	updateSimfileDriveFile,
	deleteSimfile
} from './chart';

beforeEach(() => {
	requestMock.mockReset();
});

describe('listSimfiles (GraphQL path)', () => {
	it('calls ListSimfiles and adapts to { data, count }', async () => {
		requestMock.mockResolvedValue({
			simfiles: {
				count: 2,
				data: [
					{
						id: '1',
						title: 't1',
						artist: 'a',
						bpm: 120,
						isPublished: true,
						hasUploadedFiles: true
					},
					{
						id: '2',
						title: 't2',
						artist: 'b',
						bpm: 130,
						isPublished: false,
						hasUploadedFiles: false
					}
				]
			}
		});
		const result = await listSimfiles({ scope: 'mine' });
		expect(requestMock).toHaveBeenCalledOnce();
		expect(result.count).toBe(2);
		expect(result.data).toHaveLength(2);
		expect(result.data[0].has_uploaded_files).toBe(true);
	});

	it('maps scope string mine → MINE enum', async () => {
		requestMock.mockResolvedValue({ simfiles: { count: 0, data: [] } });
		await listSimfiles({ scope: 'mine' });
		const vars = requestMock.mock.calls[0][1] as { scope: string };
		expect(vars.scope).toBe('MINE');
	});

	it('maps scope string published → PUBLISHED enum', async () => {
		requestMock.mockResolvedValue({ simfiles: { count: 0, data: [] } });
		await listSimfiles({ scope: 'published' });
		const vars = requestMock.mock.calls[0][1] as { scope: string };
		expect(vars.scope).toBe('PUBLISHED');
	});
});

describe('getSimfile', () => {
	it('GraphQL: calls GetSimfile and unwraps', async () => {
		requestMock.mockResolvedValue({
			simfile: {
				id: '7',
				title: 't',
				googleDriveFileId: 'drive-file-123',
				files: [],
				hasUploadedFiles: false
			}
		});
		const result = await getSimfile('7');
		expect(result.id).toBe(7);
		expect(result.google_drive_file_id).toBe('drive-file-123');
	});

	it('throws "Simfile not found" when result.simfile is null', async () => {
		requestMock.mockResolvedValue({ simfile: null });
		await expect(getSimfile('999')).rejects.toThrow('Simfile not found');
	});
});

describe('updateSimfile', () => {
	it('GraphQL: calls UpdateSimfile mutation and returns files + hasUploadedFiles', async () => {
		requestMock.mockResolvedValue({
			updateSimfile: {
				id: '9',
				title: 'new',
				files: [{ key: 'charts/test.zip', size: 1024, uploaded: '2025-01-01' }],
				hasUploadedFiles: true
			}
		});
		const result = await updateSimfile('9', { title: 'new' });
		expect(result.title).toBe('new');
		expect(result.files).toHaveLength(1);
		expect(result.files?.[0]?.key).toBe('charts/test.zip');
		expect(result.has_uploaded_files).toBe(true);
	});
});

describe('updateSimfileDriveFile', () => {
	it('sends the Drive URL query, resource key, and fragment unchanged', async () => {
		const downloadUrl =
			'https://drive.google.com/uc?export=download&resourcekey=abc123#section';
		requestMock.mockResolvedValue({
			updateSimfileDriveFile: {
				id: '9',
				googleDriveFileId: 'drive-file-123',
				downloadUrl
			}
		});

		const result = await updateSimfileDriveFile('9', 'drive-file-123', downloadUrl);

		expect(requestMock).toHaveBeenCalledWith(expect.anything(), {
			id: '9',
			googleDriveFileId: 'drive-file-123',
			downloadUrl
		});
		expect(result).toEqual({
			id: 9,
			google_drive_file_id: 'drive-file-123',
			download_url: downloadUrl
		});
	});

	it('rejects a non-numeric server id with "Invalid simfile id"', async () => {
		requestMock.mockResolvedValue({
			updateSimfileDriveFile: {
				id: 'abc',
				googleDriveFileId: 'drive-file-123',
				downloadUrl: 'https://drive.google.com/uc?id=drive-file-123'
			}
		});

		await expect(
			updateSimfileDriveFile(
				'abc',
				'drive-file-123',
				'https://drive.google.com/uc?id=drive-file-123'
			)
		).rejects.toThrow('Invalid simfile id: abc');
	});

	it('maps null googleDriveFileId/downloadUrl to null fields', async () => {
		requestMock.mockResolvedValue({
			updateSimfileDriveFile: {
				id: '9',
				googleDriveFileId: null,
				downloadUrl: null
			}
		});

		const result = await updateSimfileDriveFile(
			'9',
			'drive-file-123',
			'https://drive.google.com/uc?id=drive-file-123'
		);

		expect(result).toEqual({
			id: 9,
			google_drive_file_id: null,
			download_url: null
		});
	});
});

describe('deleteSimfile', () => {
	it('GraphQL: calls DeleteSimfile', async () => {
		requestMock.mockResolvedValue({ deleteSimfile: { id: '3', deleted: true } });
		const result = await deleteSimfile('3');
		expect(result.deleted).toBe(true);
	});

	it('maps partialDeletion and message from response', async () => {
		requestMock.mockResolvedValue({
			deleteSimfile: {
				id: '3',
				deleted: true,
				partialDeletion: true,
				message: 'Some files could not be deleted'
			}
		});
		const result = await deleteSimfile('3');
		expect(result.partialDeletion).toBe(true);
		expect(result.message).toBe('Some files could not be deleted');
	});

	it('throws for non-numeric id', async () => {
		requestMock.mockResolvedValue({ deleteSimfile: { id: 'abc', deleted: false } });
		await expect(deleteSimfile('abc')).rejects.toThrow('Invalid simfile id: abc');
	});
});
