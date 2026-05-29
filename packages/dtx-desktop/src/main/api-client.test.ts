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
	getSimfileWithFiles,
	me,
	upsertUserProfile,
	generateMagicLink
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

	it('listSimfiles returns { success: false, error, code } on GraphQL error', async () => {
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
		if (!r.success) {
			expect(r.error).toContain('INTERNAL');
			expect(r.code).toBe('INTERNAL');
		}
	});

	it('updateSimfile passes id + input as variables', async () => {
		requestMock.mockResolvedValue({ updateSimfile: { id: '7', title: 'x' } });
		await updateSimfile('7', { title: 'x' });
		const [, vars] = requestMock.mock.calls[0];
		expect(vars).toEqual({ id: '7', input: { title: 'x' } });
	});

	it('deleteSimfile returns shaped data with partialDeletion fields', async () => {
		requestMock.mockResolvedValue({ deleteSimfile: { id: '3', deleted: true } });
		const r = await deleteSimfile('3');
		expect(r).toEqual({ success: true, data: { id: '3', deleted: true } });
	});

	it('deleteSimfile includes partialDeletion when present', async () => {
		requestMock.mockResolvedValue({
			deleteSimfile: {
				id: '3',
				deleted: true,
				partialDeletion: true,
				message: '1 file(s) could not be deleted from storage'
			}
		});
		const r = await deleteSimfile('3');
		expect(r).toEqual({
			success: true,
			data: {
				id: '3',
				deleted: true,
				partialDeletion: true,
				message: '1 file(s) could not be deleted from storage'
			}
		});
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

	it('getSimfile returns NOT_FOUND when simfile is null', async () => {
		requestMock.mockResolvedValue({ simfile: null });
		const r = await getSimfile('999');
		expect(r).toEqual({ success: false, error: 'Simfile not found', code: 'NOT_FOUND' });
	});

	it('getSimfileWithFiles returns NOT_FOUND when simfile is null', async () => {
		requestMock.mockResolvedValue({ simfile: null });
		const r = await getSimfileWithFiles('999');
		expect(r).toEqual({ success: false, error: 'Simfile not found', code: 'NOT_FOUND' });
	});

	it('error result includes code from GraphQL extensions', async () => {
		const err = new ClientError(
			{
				errors: [{ message: 'forbidden', extensions: { code: 'FORBIDDEN' } }],
				data: null,
				status: 200,
				headers: new Headers()
			} as unknown as Parameters<typeof ClientError>[0],
			{ query: '' } as Parameters<typeof ClientError>[1]
		);
		requestMock.mockRejectedValue(err);
		const r = await getSimfile('1');
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.code).toBe('FORBIDDEN');
			expect(r.error).toContain('FORBIDDEN');
		}
	});

	it('returns timeout error on AbortError', async () => {
		const err = new Error('aborted');
		err.name = 'AbortError';
		requestMock.mockRejectedValue(err);
		const r = await listSimfiles({ scope: 'MINE' });
		expect(r).toEqual({ success: false, error: 'Request timed out after 30000ms' });
	});

	it('returns error message without code when ClientError has no extensions code', async () => {
		const err = new ClientError(
			{
				errors: [{ message: 'something broke' }],
				data: null,
				status: 200,
				headers: new Headers()
			} as unknown as Parameters<typeof ClientError>[0],
			{ query: '' } as Parameters<typeof ClientError>[1]
		);
		requestMock.mockRejectedValue(err);
		const r = await listSimfiles({ scope: 'MINE' });
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error).toBe('something broke');
			expect(r.code).toBeUndefined();
		}
	});

	it('falls back to HTTP status when ClientError has empty errors array', async () => {
		const err = new ClientError(
			{
				errors: [],
				data: null,
				status: 500,
				headers: new Headers()
			} as unknown as Parameters<typeof ClientError>[0],
			{ query: '' } as Parameters<typeof ClientError>[1]
		);
		requestMock.mockRejectedValue(err);
		const r = await listSimfiles({ scope: 'MINE' });
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error).toBe('HTTP 500');
		}
	});

	it('returns generic Error message for non-ClientError errors', async () => {
		requestMock.mockRejectedValue(new Error('network failure'));
		const r = await listSimfiles({ scope: 'MINE' });
		expect(r).toEqual({ success: false, error: 'network failure' });
	});

	it('returns Unknown error for non-Error objects', async () => {
		requestMock.mockRejectedValue('a string');
		const r = await listSimfiles({ scope: 'MINE' });
		expect(r).toEqual({ success: false, error: 'Unknown error' });
	});

	it('createSimfile passes input and returns data', async () => {
		requestMock.mockResolvedValue({ createSimfile: { id: '10', title: 'new' } });
		const r = await createSimfile({ title: 'new' });
		expect(r).toEqual({ success: true, data: { createSimfile: { id: '10', title: 'new' } } });
		const [, vars] = requestMock.mock.calls[0];
		expect(vars).toEqual({ input: { title: 'new' } });
	});

	it('me returns user data', async () => {
		requestMock.mockResolvedValue({ me: { id: 'u1', email: 'a@b.c' } });
		const r = await me();
		expect(r).toEqual({ success: true, data: { me: { id: 'u1', email: 'a@b.c' } } });
	});

	it('upsertUserProfile passes input and returns data', async () => {
		requestMock.mockResolvedValue({ upsertUserProfile: { id: 'u1', displayName: 'x' } });
		const r = await upsertUserProfile({ displayName: 'x' });
		expect(r).toEqual({
			success: true,
			data: { upsertUserProfile: { id: 'u1', displayName: 'x' } }
		});
		const [, vars] = requestMock.mock.calls[0];
		expect(vars).toEqual({ input: { displayName: 'x' } });
	});

	it('generateMagicLink returns mutation data', async () => {
		requestMock.mockResolvedValue({ generateMagicLink: { url: 'https://magic' } });
		const r = await generateMagicLink();
		expect(r).toEqual({ success: true, data: { generateMagicLink: { url: 'https://magic' } } });
	});
});
