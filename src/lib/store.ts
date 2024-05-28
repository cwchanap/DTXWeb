import { writable } from 'svelte/store';

const activeScene = writable<string | null>(null);

export default {
	activeScene
};
