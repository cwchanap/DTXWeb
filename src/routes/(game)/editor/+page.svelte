<script lang="ts">
	import { Game, type Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@/game/main.svelte';
	import { goto } from '$app/navigation';
	import store from '@/lib/store';
	import { Editor } from '@/game/scenes/Editor';
	import { onDestroy, onMount } from 'svelte';
	import EditorTab from '@/lib/components/EditorTab.svelte';
	import { popup, FileButton } from '@skeletonlabs/skeleton';
	import { DTXFile } from '@/lib/chart/dtx';
	import { MainMenu } from '@/game/scenes/MainMenu';

	let phaserRef: TPhaserRef = { game: null, scene: null };
	let dtxFile: DTXFile | null = null;

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

	async function importFile(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		console.log('importFile', file);
		dtxFile = new DTXFile(file);
		await dtxFile.parse();
		dtxFile = dtxFile;
	}

	function exportFile() {
		dtxFile?.export();
	}

	onMount(() => {
		store.activeScene.set(Editor.key);
	});
</script>

<div data-popup="file-menu">
	<div class="btn-group-vertical absolute mt-1 rounded border border-gray-300 bg-white shadow-lg">
		<FileButton name="files" button="hover:bg-gray-100" accept=".dtx" on:change={importFile}
			>Open</FileButton
		>
		<button class="hover:bg-gray-100" on:click={exportFile}>Export</button>
	</div>
</div>

<div class="grid h-screen grid-cols-1 grid-rows-[auto,1fr]">
	<div class="relative row-span-1 flex flex-row items-center border-b-2 border-gray-400">
		<button
			use:popup={{ event: 'click', target: 'file-menu', placement: 'bottom' }}
			class="w-1/12 rounded bg-gray-200 py-2 hover:bg-gray-300"
		>
			File
		</button>
		<div class="h-8 border-l border-gray-300"></div>
	</div>
	<div class="row-span-1 flex flex-row">
		<div class="w-[25%] pt-16">
			<EditorTab {dtxFile} />
		</div>
		<div class="flex w-[55%] justify-center p-5">
			<Main {phaserRef} {currentActiveScene} />
		</div>
		<div class="flex w-[20%] flex-col items-end justify-end p-16">
			<button
				class="focus:outline-non mt-5 w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
				on:click={() => {
					goto('/game');
					store.activeScene.set(MainMenu.key);
				}}>Game</button
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
</div>
