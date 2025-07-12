import { sveltekit } from '@sveltejs/kit/vite';
import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [wasm(), tailwindcss(), sveltekit()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
			'@dtx/common/components': path.resolve(__dirname, '../common/src/lib/components.ts'),
			'@dtx/common': path.resolve(__dirname, '../common/src/lib')
		}
	},
	optimizeDeps: {
		exclude: ['xa_decoder']
	},
	server: {
		fs: {
			allow: [path.resolve(__dirname, '../../')]
		}
	}
});
