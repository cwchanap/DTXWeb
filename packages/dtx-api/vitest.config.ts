import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			// Keep '@dtx/common/server' before '@dtx/common': Vite matches string aliases
			// by prefix, so the main alias would otherwise intercept the /server import.
			'@dtx/common/server': path.resolve(__dirname, '../common/src/lib/server.ts'),
			'@dtx/common': path.resolve(__dirname, '../common/src/lib/index.ts')
		}
	},
	test: {
		environment: 'node',
		globals: false,
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			include: ['src/**/*.ts'],
			exclude: ['**/*.test.ts'],
			all: true
		}
	}
});
