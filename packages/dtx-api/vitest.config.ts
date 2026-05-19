import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@dtx/common/server': path.resolve(__dirname, '../common/src/lib/server.ts')
		}
	},
	test: {
		environment: 'node',
		globals: false,
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['**/*.test.ts']
		}
	}
});
