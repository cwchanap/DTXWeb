import { sveltekit } from '@sveltejs/kit/vite';
import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
	envDir: workspaceRoot,
	plugins: [wasm(), tailwindcss(), sveltekit()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
			'@dtx/common/components': path.resolve(__dirname, '../common/src/lib/components.ts'),
			'@dtx/common': path.resolve(__dirname, '../common/src/lib'),
			'@dtx/ui-components/components': path.resolve(
				__dirname,
				'../ui-components/src/lib/components.ts'
			),
			'@dtx/ui-components': path.resolve(__dirname, '../ui-components/src/lib')
		}
	},
	optimizeDeps: {
		exclude: ['xa_decoder']
	},
	server: {
		fs: {
			allow: [workspaceRoot]
		}
	}
});
