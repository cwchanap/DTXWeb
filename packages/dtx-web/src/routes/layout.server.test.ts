import { describe, expect, it } from 'vitest';

import { load } from './+layout.server';

type LayoutServerLoadArg = Parameters<typeof load>[0];
type LayoutServerLoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

const requireLayoutLoadResult = (
	result: Awaited<ReturnType<typeof load>>
): LayoutServerLoadResult => {
	if (result === undefined) {
		throw new Error('Expected load() to return layout data');
	}
	return result;
};

describe('+layout.server load', () => {
	it('returns neutral session and user data from locals', async () => {
		const session = { id: 'session-1' };
		const user = { id: 'user-1' };
		const result = requireLayoutLoadResult(
			await load({ locals: { session, user } } as unknown as LayoutServerLoadArg)
		);

		expect(result).toEqual({ session, user });
	});

	it('returns null session and user when not authenticated', async () => {
		const result = requireLayoutLoadResult(
			await load({ locals: { session: null, user: null } } as unknown as LayoutServerLoadArg)
		);

		expect(result).toEqual({ session: null, user: null });
	});
});
