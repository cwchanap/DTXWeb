import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		envPrefix: ['VITE_', 'PUBLIC_'],
		resolve: {
			alias: {
				'@dtx/common/components': path.resolve(
					__dirname,
					'../common/src/lib/components.ts'
				),
				'@dtx/common': path.resolve(__dirname, '../common/src/lib')
			}
		}
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				output: {
					entryFileNames: '[name].js'
				}
			}
		},
		resolve: {
			alias: {
				'@dtx/common/components': path.resolve(
					__dirname,
					'../common/src/lib/components.ts'
				),
				'@dtx/common': path.resolve(__dirname, '../common/src/lib')
			}
		}
	},
	renderer: {
		// @ts-ignore
		plugins: [tailwindcss(), svelte()],
		envDir: '../../',
		envPrefix: ['VITE_', 'PUBLIC_'],
		publicDir: 'static',
		resolve: {
			alias: {
				'@dtx/common/components': path.resolve(
					__dirname,
					'../common/src/lib/components.ts'
				),
				'@dtx/common': path.resolve(__dirname, '../common/src/lib')
			}
		}
	}
});
