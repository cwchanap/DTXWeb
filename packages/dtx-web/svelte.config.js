import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: [vitePreprocess({})],

	kit: {
		// adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
		// If your environment is not supported or you settled on a specific environment, switch out the adapter.
		// See https://kit.svelte.dev/docs/adapters for more information about adapters.
		adapter: adapter({
			fallback: 'plaintext'
		}),
		alias: {
			'@': './src',
			'@dtx/common/components': '../common/src/lib/components.ts',
			'@dtx/common': '../common/src/lib'
		},
		csrf: {
			checkOrigin: (origin, { request }) => {
				// Allow requests from desktop app
				const userAgent = request.headers.get('user-agent');
				const requestedWith = request.headers.get('x-requested-with');

				if (userAgent?.includes('DTXDesktopApp') && requestedWith === 'DTXDesktopApp') {
					return true;
				}

				// For all other requests, check origin normally
				return origin === 'https://dtx.hapadona.com';
			}
		}
	}
};

export default config;
