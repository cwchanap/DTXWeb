import { json } from '@sveltejs/kit';
import { getDb, searchSimfiles } from '$lib/server/db';
import logger from '$lib/server/logger';

/** GET /api/chart/search — Search charts by title/artist */
export async function GET({
	url,
	platform,
	locals
}: {
	url: URL;
	platform: App.Platform;
	locals: App.Locals;
}) {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const query = url.searchParams.get('q') ?? '';
	if (!query.trim()) return json({ data: [] });

	const excludeParam = url.searchParams.get('exclude') ?? '';
	const excludeIds = excludeParam
		? excludeParam
				.split(',')
				.map(Number)
				.filter((n) => Number.isSafeInteger(n))
		: [];
	const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 8)));

	try {
		const db = getDb(platform);
		const results = await searchSimfiles(db, { query, excludeIds, limit });
		return json({ data: results });
	} catch (error) {
		logger.error('Error searching charts:', error);
		return json({ error: 'Failed to search charts' }, { status: 500 });
	}
}
