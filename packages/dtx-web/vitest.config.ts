import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
	plugins: [svelte({ hot: false })],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/tests/setup.ts'],
		// Ensure we're using the client version of Svelte for testing
		server: {
			deps: {
				inline: [/^svelte/]
			}
		},
		// Exclude playwright tests
		exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
		deps: {
			// Tell Vitest to look for modules in the root directory as well
			moduleDirectories: ['node_modules', path.resolve(__dirname, '../..')]
		},
		env: {
			// Set the environment to production for testing
			PUBLIC_SKIN_BUCKET_URL: 'http://localhost:5173/skin',
			PUBLIC_SUPABASE_URL: 'http://localhost:5173',
			PUBLIC_SUPABASE_ANON_KEY: 'my_awesome_anon_key',
			PUBLIC_CLOUDFLARE_R2_PUBLIC_URL: 'http://localhost:5173',
			PUBLIC_SIMFILE_BUCKET_URL: 'http://localhost:5173',
			PUBLIC_CLOUDFARE_WORKER_URL: 'http://localhost:5173',
			SUPABASE_PROJECT_ID: 'my_awesome_project_id',
			CLOUDFLARE_ACCOUNT_ID: 'my_awesome_account_id',
			CLOUDFLARE_ACCESS_KEY_ID: 'my_awsome_key_id',
			CLOUDFLARE_ACCESS_KEY_SECRET: 'my_awsome_key_secret',
			VITE_DTX_SERVER_URL: 'http://localhost:5173'
		}
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			$lib: path.resolve(__dirname, './src/lib')
		}
	}
});
