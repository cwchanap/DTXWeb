import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
	plugins: [tailwindcss(), svelte({ hot: false, compilerOptions: { runes: true } }), sveltekit()],
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
				'**/app.d.ts'
			],
			include: ['src/**/*.{js,ts,svelte}'],
			all: true
		},
		deps: {
			optimizer: {
				web: {
					include: ['svelte', '@testing-library/svelte']
				}
			},
			moduleDirectories: ['node_modules', path.resolve(__dirname, '../..')]
		}
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			$lib: path.resolve(__dirname, './src/lib')
		}
	}
});
