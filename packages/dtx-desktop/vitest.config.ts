import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/tests/setup.ts'],
		// Exclude playwright tests and build outputs
		exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/e2e/**'],
		deps: {
			// Tell Vitest to look for modules in the root directory as well
			moduleDirectories: ['node_modules', path.resolve(__dirname, '../..')]
		},
		env: {
			// Set test environment variables
			VITE_DTX_SERVER_URL: 'http://localhost:5173'
		}
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src/renderer/src')
		}
	}
});
