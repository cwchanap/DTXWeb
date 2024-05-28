<script lang="ts">
	import type { Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@/game/main.svelte';
	import { goto } from '$app/navigation';
	import store from '@/lib/store';
	import { Editor } from '@/game/scenes/Editor';
	import { onDestroy } from 'svelte';
	import EditorTab from '@/lib/components/EditorTab.svelte';

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

<div id="app" class="flex min-h-screen flex-row space-y-4 p-16">
	<div class="flex-1 pt-16">
		{#if currentScene === Editor.key}
			<EditorTab />
		{/if}
	</div>
	<div class="flex-1 p-5">
		<Main {phaserRef} {currentActiveScene} />
	</div>
	<div class="flex flex-1 flex-col items-end justify-end p-16">
		<button
			class="focus:outline-non mt-5 w-1/4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
			on:click={() => {
				phaserRef.scene?.scene.start(Editor.key);
				store.activeScene.set(Editor.key);
			}}>Editor</button
		>
		<button
			class="focus:outline-non mt-5 w-1/4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
			on:click={() => {
				goto('/');
				store.activeScene.set(null);
			}}>Main</button
		>
	</div>
</div>

<style>
	#app {
		width: 100%;
		height: 100vh;
		/* overflow: hidden; */
		/* display: flex; */
	}
</style>
