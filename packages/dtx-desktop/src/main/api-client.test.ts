import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientError } from 'graphql-request';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('./graphql/client', () => ({
	getGraphQLClient: vi.fn().mockResolvedValue({ request: requestMock })
}));

import {
	listSimfiles,
	getSimfile,
	createSimfile,
	updateSimfile,
	deleteSimfile,
	nextDisplayId,
	simfileSearch,
	getSimfileWithFiles
} from './api-client';

beforeEach(() => {
	requestMock.mockReset();
});

describe('api-client', () => {
	it('listSimfiles returns { success: true, data } on happy path', async () => {
		requestMock.mockResolvedValue({ simfiles: { count: 0, data: [] } });
		const r = await listSimfiles({ scope: 'MINE' });
		expect(r).toEqual({ success: true, data: { count: 0, data: [] } });
	});

	it('listSimfiles returns { success: false, error } on GraphQL error', async () => {
		const err = new ClientError(
			{
				errors: [{ message: 'oops', extensions: { code: 'INTERNAL' } }],
				data: null,
				status: 200,
				headers: new Headers()
			} as unknown as Parameters<typeof ClientError>[0],
			{ query: '' } as Parameters<typeof ClientError>[1]
		);
		requestMock.mockRejectedValue(err);
		const r = await listSimfiles({ scope: 'MINE' });
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toContain('INTERNAL');
	});

	it('updateSimfile passes id + input as variables', async () => {
		requestMock.mockResolvedValue({ updateSimfile: { id: '7', title: 'x' } });
		await updateSimfile('7', { title: 'x' });
		const [, vars] = requestMock.mock.calls[0];
		expect(vars).toEqual({ id: '7', input: { title: 'x' } });
	});

	it('deleteSimfile returns shaped data', async () => {
		requestMock.mockResolvedValue({ deleteSimfile: { id: '3', deleted: true } });
		const r = await deleteSimfile('3');
		expect(r).toEqual({ success: true, data: { id: '3', deleted: true } });
	});

	it('nextDisplayId returns the integer', async () => {
		requestMock.mockResolvedValue({ nextDisplayId: 42 });
		const r = await nextDisplayId();
		expect(r).toEqual({ success: true, data: 42 });
	});

	it('simfileSearch passes args', async () => {
		requestMock.mockResolvedValue({ simfileSearch: [] });
		await simfileSearch({ query: 'q', limit: 5 });
		const [, vars] = requestMock.mock.calls[0];
		expect(vars).toEqual({ query: 'q', limit: 5, excludeIds: undefined });
	});

	it('getSimfileWithFiles selects files', async () => {
		requestMock.mockResolvedValue({
			simfile: { id: '1', files: [{ key: 'a', size: 1, uploaded: 't' }] }
		});
		const r = await getSimfileWithFiles('1');
		expect(r.success).toBe(true);
		if (r.success && r.data) expect(r.data.files).toHaveLength(1);
	});
});
