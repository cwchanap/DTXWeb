import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/tests/setup.ts'],
		// Exclude playwright tests and build outputs
		exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/e2e/**'],
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
			'@dtx/common/server': path.resolve(
				__dirname,
				'../../packages/common/src/lib/server.ts'
			),
			'@dtx/common': path.resolve(__dirname, '../../packages/common/src/lib/index.ts')
		}
	}
});
