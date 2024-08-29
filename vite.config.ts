import { sveltekit } from '@sveltejs/kit/vite';
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { defineConfig } from 'vite';
import path from 'path';


export default defineConfig({
	plugins: [wasm(), topLevelAwait(), sveltekit()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src')
		}
	},
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['./src/tests/setup.ts']
	}
});
