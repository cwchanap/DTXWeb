import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'path';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/tests/setup.ts'],
		// Ensure we're using the client version of Svelte for testing
		server: {
			deps: {
				inline: [/^svelte/, /@dtx\/common/]
			}
		},
		// Exclude playwright tests
		exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
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
				'**/app.css',
				'**/constant.ts',
				'**/global.d.ts',
				'**/hooks.server.ts',
				'**/e2e/**'
			],
			include: ['src/**/*.{js,ts,svelte}'],
			all: true
		},
		deps: {
			// Tell Vitest to look for modules in the root directory as well
			moduleDirectories: ['node_modules', path.resolve(__dirname, '../..')]
		},
		env: {
			// Set the environment to production for testing
			PUBLIC_SUPABASE_URL: 'http://localhost:5173',
			PUBLIC_SUPABASE_ANON_KEY: 'my_awesome_anon_key',
			PUBLIC_SIMFILE_BUCKET_URL: 'http://localhost:5173',
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
