import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { logger, searchSimfiles } from '@dtx/common/server';

/** GET /api/chart/search — Search charts by title/artist */
export const GET = async ({
	url,
	platform,
	locals
}: {
	url: URL;
	platform: App.Platform;
	locals: App.Locals;
}) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const queryRaw = url.searchParams.get('q') ?? '';
	const query = queryRaw.trim();
	if (!query) return json({ data: [] });

	const excludeParam = url.searchParams.get('exclude') ?? '';
	const excludeIds = excludeParam
		? excludeParam
				.split(',')
				.map(Number)
				.filter((n) => Number.isSafeInteger(n))
		: [];
	const limitParam = parseInt(url.searchParams.get('limit') ?? '', 10);
	const limit = Math.min(50, Math.max(1, Number.isFinite(limitParam) ? limitParam : 8));

	try {
		const db = getDb(platform);
		const results = await searchSimfiles(db, { query, userId: user.id, excludeIds, limit });
		const data = results.map((result) => ({
			...result,
			is_published: result.is_published === 1
		}));
		return json({ data });
	} catch (error) {
		logger.error('Error searching charts:', error);
		return json({ error: 'Failed to search charts' }, { status: 500 });
	}
};
