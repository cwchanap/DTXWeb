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

import { listSimfiles, getSimfile, updateSimfile, deleteSimfile } from './chart';

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
			simfile: { id: '7', title: 't', files: [], hasUploadedFiles: false }
		});
		const result = await getSimfile('7');
		expect(result.id).toBe(7);
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

describe('deleteSimfile', () => {
	it('GraphQL: calls DeleteSimfile', async () => {
		requestMock.mockResolvedValue({ deleteSimfile: { id: '3', deleted: true } });
		const result = await deleteSimfile('3');
		expect(result.deleted).toBe(true);
	});
});
