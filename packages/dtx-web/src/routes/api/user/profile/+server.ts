import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { logger, getUserProfile, upsertUserProfile } from '@dtx/common/server';

/** GET /api/user/profile — Get current user's profile */
export const GET = async ({ platform, locals }: { platform: App.Platform; locals: App.Locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const db = getDb(platform);
		const profile = await getUserProfile(db, user.id);
		if (!profile) return json({ error: 'Profile not found' }, { status: 404 });
		return json(profile);
	} catch (error) {
		logger.error('Error getting user profile:', error);
		return json({ error: 'Failed to get profile' }, { status: 500 });
	}
};

/** PUT /api/user/profile — Create or update user profile */
export const PUT = async ({
	request,
	platform,
	locals
}: {
	request: Request;
	platform: App.Platform;
	locals: App.Locals;
}) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const username = typeof body.username === 'string' ? body.username.trim() : '';
	if (!username || username.length > 30) {
		return json({ error: 'Username must be 1-30 characters' }, { status: 400 });
	}

	try {
		const db = getDb(platform);

		const profile = await upsertUserProfile(db, {
			user_id: user.id,
			username
		});

		return json(profile);
	} catch (error) {
		logger.error('Error upserting user profile:', error);
		return json({ error: 'Failed to update profile' }, { status: 500 });
	}
};
