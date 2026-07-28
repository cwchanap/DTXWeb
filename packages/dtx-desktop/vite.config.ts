import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// package.json is "type": "module", so __dirname is not defined natively.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
	root: 'src/renderer',
	envDir: workspaceRoot,
	envPrefix: ['VITE_', 'PUBLIC_'],
	publicDir: '../../static',
	plugins: [wasm(), tailwindcss(), svelte()],
	server: {
		port: 5174,
		strictPort: true
	},
	build: {
		outDir: '../../dist',
		emptyOutDir: true
	},
	optimizeDeps: {
		exclude: ['xa_decoder']
	},
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/renderer/src'),
			'@dtx/ui-components': path.resolve(__dirname, '../ui-components/src/lib'),
			'@dtx/common/components': path.resolve(__dirname, '../common/src/lib/components.ts'),
			'@dtx/common/game': path.resolve(__dirname, '../common/src/lib/game.ts'),
			'@dtx/common/server': path.resolve(__dirname, '../common/src/lib/server.ts'),
			'@dtx/common': path.resolve(__dirname, '../common/src/lib')
		}
	}
});
