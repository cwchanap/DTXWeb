import { redirect, fail } from '@sveltejs/kit';

import type { Actions } from './$types';

export const actions: Actions = {
	login: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;
		const redirectToDesktop = formData.get('redirect') === 'desktop';

		const { error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			console.error('Login error:', error);
			return fail(400, {
				success: false,
				error: error.message
			});
		}

		// Login successful, redirect to app
		if (redirectToDesktop) {
			redirect(303, '/app?redirect=desktop');
		} else {
			redirect(303, '/app');
		}
	}
};
