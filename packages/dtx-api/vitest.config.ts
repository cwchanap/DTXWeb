import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			// Alias @dtx/common to source so Vitest never depends on the built
			// dist output of the shared workspace package.
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
