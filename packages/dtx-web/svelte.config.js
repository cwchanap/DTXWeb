import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

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
		env: {
			dir: workspaceRoot
		},
		alias: {
			'@': './src',
			'@dtx/common/components': '../common/src/lib/components.ts',
			'@dtx/common/server': '../common/src/lib/server.ts',
			'@dtx/common': '../common/src/lib'
		},
		csrf: {
			checkOrigin: false
		}
	}
};

export default config;
