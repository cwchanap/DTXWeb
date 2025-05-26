import { cloudflare } from '@cloudflare/vite-plugin';
import build from '@hono/vite-build/cloudflare-workers';
import { defineConfig } from 'vite';
import ssrHotReload from 'vite-plugin-ssr-hot-reload';
import { PluginOption } from 'vite';
import path from 'path';

export default defineConfig(({ command }) => {
	const plugins: PluginOption[] = [];
	if (command === 'serve') {
		plugins.push(ssrHotReload(), cloudflare());
	} else {
		plugins.push(build({ outputDir: 'dist-server' }));
	}
	return {
		plugins,
		server: {
			port: 8787
		},
		resolve: {
			alias: {
				'@': path.resolve(__dirname, './src')
			}
		}
	};
});
