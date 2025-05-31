import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		envPrefix: ['VITE_', 'PUBLIC_']
	},
	preload: {
		plugins: [externalizeDepsPlugin()]
	},
	renderer: {
		// @ts-ignore
		plugins: [tailwindcss(), svelte()],
		envDir: '../../',
		envPrefix: ['VITE_', 'PUBLIC_']
	}
});
