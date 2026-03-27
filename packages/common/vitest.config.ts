import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/tests/setup.ts'],
		// Exclude build outputs and test files from coverage
		exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.svelte-kit/**'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			exclude: [
				'**/node_modules/**',
				'**/dist/**',
				'**/build/**',
				'**/.svelte-kit/**',
				'**/tests/**',
				'**/test/**',
				'**/*.test.ts',
				'**/*.spec.ts',
				'**/vite.config.ts',
				'**/vitest.config.ts',
				'**/svelte.config.js',
				'**/app.html',
				'**/app.d.ts',
				'**/__mocks__/**'
			],
			include: ['src/**/*.{js,ts,svelte}'],
			all: true
		},
		// Force browser conditions for Svelte 5 client rendering
		pool: 'forks',
		deps: {
			moduleDirectories: ['node_modules', path.resolve(__dirname, '../..')]
		},
		server: {
			deps: {
				inline: [/^svelte/, /@dtx\/common/],
				external: ['phaser3spectorjs', 'svelte/server']
			}
		}
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			$lib: path.resolve(__dirname, './src/lib'),
			phaser: path.resolve(__dirname, '../../__mocks__/phaser.ts')
		},
		conditions: ['browser']
	}
});
