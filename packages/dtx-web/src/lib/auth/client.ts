import { createAuthClient } from 'better-auth/svelte';
import { deviceAuthorizationClient } from 'better-auth/client/plugins';

import { PUBLIC_DTX_API_URL } from '$env/static/public';

export const authClient = createAuthClient({
	baseURL: PUBLIC_DTX_API_URL,
	fetchOptions: {
		credentials: 'include'
	},
	plugins: [deviceAuthorizationClient()]
});
