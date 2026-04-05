import { defineConfig } from 'vitest/config';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
	plugins: [svelte({ hot: false, preprocess: vitePreprocess() })],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/tests/setup.ts'],
		// Exclude playwright tests and build outputs
		exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/e2e/**'],
		server: {
			deps: {
				inline: [/^svelte/, /@testing-library\/svelte/],
				external: ['svelte/server']
			}
		},
		pool: 'forks',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			exclude: [
				'**/node_modules/**',
				'**/dist/**',
				'**/out/**',
				'**/build/**',
				'**/tests/**',
				'**/test/**',
				'**/*.test.ts',
				'**/*.spec.ts',
				'**/vite.config.ts',
				'**/vitest.config.ts',
				'**/electron.vite.config.ts',
				'**/electron-builder.yml',
				'**/dev-app-update.yml',
				'**/e2e/**',
				'**/preload/**'
			],
			include: ['src/**/*.{js,ts,svelte}'],
			all: true
		},
		deps: {
			// Tell Vitest to look for modules in the root directory as well
			moduleDirectories: ['node_modules', path.resolve(__dirname, '../..')]
		},
		env: {
			// Set test environment variables
			VITE_DTX_SERVER_URL: 'http://localhost:5173',
			PUBLIC_SUPABASE_URL: 'http://localhost:5173',
			PUBLIC_SUPABASE_ANON_KEY: 'test_anon_key',
			PUBLIC_SIMFILE_BUCKET_URL: 'http://localhost:5173'
		}
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src/renderer/src'),
			'@dtx/common/game': path.resolve(__dirname, '../../packages/common/src/lib/game.ts'),
			'@dtx/common/server': path.resolve(
				__dirname,
				'../../packages/common/src/lib/server.ts'
			),
			'@dtx/common': path.resolve(__dirname, '../../packages/common/src/lib/index.ts'),
			'@dtx/ui-components/components/Modal.svelte': path.resolve(
				__dirname,
				'../../__mocks__/@dtx/ui-components/Modal.svelte'
			),
			'@dtx/ui-components': path.resolve(
				__dirname,
				'../../packages/ui-components/src/lib/index.ts'
			)
		},
		conditions: ['browser']
	}
});
