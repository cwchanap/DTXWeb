import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// @ts-expect-error monorepo error
	plugins: [sveltekit()]
});
