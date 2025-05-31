import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';

// Create admin client with service role key
const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: {
		autoRefreshToken: false,
		persistSession: false
	}
});

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		// Check if user is authenticated
		const { session } = await locals.safeGetSession();
		if (!session || !session.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { email } = session.user;
		if (!email) {
			return json({ error: 'User email not found' }, { status: 400 });
		}

		// Generate magic link for the authenticated user
		const { data: magicLink, error } = await supabaseAdmin.auth.admin.generateLink({
			type: 'magiclink',
			email: email,
			options: {
				redirectTo: 'dtx://auth-callback'
			}
		});

		if (error) {
			console.error('Failed to generate magic link:', error);
			return json({ error: 'Failed to generate magic link' }, { status: 500 });
		}

		if (!magicLink.properties?.action_link) {
			return json({ error: 'Invalid magic link generated' }, { status: 500 });
		}

		// Return the magic link URL
		return json({
			magicLinkUrl: magicLink.properties.action_link,
			success: true
		});
	} catch (error) {
		console.error('Magic link generation error:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
