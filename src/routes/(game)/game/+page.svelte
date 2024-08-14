<script lang="ts">
	import type { Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@/game/main.svelte';
	import { goto } from '$app/navigation';
	import store from '@/lib/store';
	import { Editor } from '@/game/scenes/Editor';
	import { onDestroy } from 'svelte';

	let phaserRef: TPhaserRef = { game: null, scene: null };

	// Event emitted from the PhaserGame component
	const currentActiveScene = (scene: Scene) => {
		return scene;
	};

	let currentScene: string | null;

	const unsubscribe = store.activeScene.subscribe((value) => {
		currentScene = value;
	});

	onDestroy(() => {
		unsubscribe();
	});
</script>

<div class="flex flex-row">
	<div class="w-[25%] pt-16" />
	<div class="flex w-[55%] justify-center p-5">
		<Main {phaserRef} {currentActiveScene} />
	</div>
	<div class="flex w-[20%] flex-col items-end justify-end p-16">
		<button
			class="focus:outline-non mt-5 w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
			on:click={() => {
				goto('/editor');
				store.activeScene.set(Editor.key);
			}}>Editor</button
		>
		<button
			class="focus:outline-non mt-5 w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
			on:click={() => {
				goto('/');
				store.activeScene.set(null);
			}}>Main</button
		>
	</div>
</div>
