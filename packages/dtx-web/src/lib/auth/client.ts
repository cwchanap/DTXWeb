import { createAuthClient } from 'better-auth/svelte';
import { deviceAuthorizationClient } from 'better-auth/client/plugins';

import { env } from '$env/dynamic/public';

export const DESKTOP_DEVICE_CLIENT_ID = 'dtx-desktop';

export const authClient = createAuthClient({
	baseURL: env.PUBLIC_DTX_API_URL,
	fetchOptions: {
		credentials: 'include'
	},
	plugins: [deviceAuthorizationClient()]
});
