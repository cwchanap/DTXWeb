import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAccessibleSimfiles } from './downloads';
import type { D1Database } from '@cloudflare/workers-types';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return { ...actual, getSimfileOwner: vi.fn() };
});

const { getSimfileOwner } = await import('@dtx/common/server');
const mockedGetOwner = vi.mocked(getSimfileOwner);

beforeEach(() => mockedGetOwner.mockReset());

describe('resolveAccessibleSimfiles', () => {
	it('classifies all four statuses correctly', async () => {
		mockedGetOwner.mockImplementation(async (_db, id) => {
			if (id === 1) return { user_id: 'u1', is_published: 1 };
			if (id === 2) return { user_id: 'u1', is_published: 0 };
			if (id === 3) return { user_id: 'someone', is_published: 0 };
			return null;
		});

		const result = await resolveAccessibleSimfiles({} as D1Database, [1, 2, 3, 4], {
			id: 'u1'
		} as { id: string });
		expect(result.accessible.sort()).toEqual([1, 2]);
		expect(result.unauthorized).toEqual([]);
		expect(result.forbidden).toEqual([3]);
		expect(result.missing).toEqual([4]);
	});

	it('marks unpublished + non-owner as unauthorized when no user is provided', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 0 });
		const result = await resolveAccessibleSimfiles({} as D1Database, [5], null);
		expect(result.unauthorized).toEqual([5]);
		expect(result.forbidden).toEqual([]);
	});

	it('treats published as accessible regardless of user', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 1 });
		const result = await resolveAccessibleSimfiles({} as D1Database, [6], null);
		expect(result.accessible).toEqual([6]);
	});
});
