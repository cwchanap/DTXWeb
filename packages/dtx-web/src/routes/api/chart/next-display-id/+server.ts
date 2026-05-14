import { json } from '@sveltejs/kit';
import { getDb, getNextDisplayId } from '$lib/server/db';
import logger from '$lib/server/logger';

export const GET = async ({ platform, locals }: { platform: App.Platform; locals: App.Locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const db = getDb(platform);
		const nextDisplayId = await getNextDisplayId(db, user.id);
		return json({ nextDisplayId });
	} catch (error) {
		logger.error('Error fetching next display_id:', { userId: user.id, error });
		return json({ error: 'Failed to fetch next display_id' }, { status: 500 });
	}
};
