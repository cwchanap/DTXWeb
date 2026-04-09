import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/tests/setup.ts'],
		pool: 'forks',
		exclude: ['**/node_modules/**', '**/dist/**'],
		server: {
			deps: {
				inline: [/^svelte/, /@testing-library\/svelte/],
				external: ['svelte/server']
			}
		},
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			exclude: [
				'**/node_modules/**',
				'**/dist/**',
				'**/.svelte-kit/**',
				'**/*.test.ts',
				'**/*.spec.ts',
				'**/vite.config.ts',
				'**/vitest.config.ts',
				'**/svelte.config.js'
			],
			include: ['src/**/*.{js,ts,svelte}'],
			all: true
		}
	},
	resolve: {
		conditions: ['browser']
	}
});
