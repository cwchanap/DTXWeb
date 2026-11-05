import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: [
			// Alias @dtx/common entry points to source so Vitest never depends on
			// the built dist output of the shared workspace package. Exact-match
			// regexes (like Wrangler/esbuild and tsconfig paths): a string key
			// would prefix-match and rewrite subpath imports such as
			// '@dtx/common/game' to 'index.ts/game'.
			{
				find: /^@dtx\/common$/,
				replacement: path.resolve(__dirname, '../common/src/lib/index.ts')
			},
			{
				find: /^@dtx\/common\/encoding$/,
				replacement: path.resolve(__dirname, '../common/src/lib/encoding.ts')
			}
		]
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
