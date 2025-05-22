import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
	plugins: [svelte({ hot: false })],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/tests/setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}'],
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
			PUBLIC_SKIN_BUCKET_URL: 'http://localhost:5173/skin'
		}
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			$lib: path.resolve(__dirname, './src/lib')
		}
	}
});
