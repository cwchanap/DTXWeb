<script lang="ts">
	import { type Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@/game/main.svelte';
	import { goto } from '$app/navigation';
	import { Editor } from '@/game/scenes/Editor';
	import { onDestroy, onMount } from 'svelte';
	import MainTab from '@/lib/components/editor/MainTab.svelte';
	import { popup, TabGroup, Tab } from '@skeletonlabs/skeleton';
	import { DTXFile } from '@/lib/chart/dtx';
	import { MainMenu } from '@/game/scenes/MainMenu';
	import SoundTab from '@/lib/components/editor/SoundTab.svelte';
	import { get } from 'svelte/store';
	import ChartFolderUpload from '@/lib/components/ChartFolderUpload.svelte';
	import type { SimFile } from '@/lib/chart/simFile';
	import EventType from '@/game/EventType';
	import store from '@/lib/store';
	import { EventBus } from '@/game/EventBus';

	let phaserRef: TPhaserRef = { game: null, scene: null };
	let currentTab: number = 0;
	let isPreviewing = false;

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

	function exportFile() {
		const dtxFile = get(store.currentDtxFile);
		dtxFile?.export();
	}

	function newFile() {
		store.currentDtxFile.set(new DTXFile());
	}

	async function onFileUpload(simfile: SimFile, highestDtx: DTXFile) {
		await highestDtx.parse();
		const notes = highestDtx.parseNotes();
		highestDtx.parseBPMChanges();
		store.currentDtxFile.set(highestDtx);
		store.currentSimfile.set(simfile);
		store.currentSoundChip.set(highestDtx.parseSoundChips());
		EventBus.emit(EventType.NOTE_IMPORT, notes);
	}

	onMount(() => {
		store.activeScene.set(Editor.key);
		store.isPreviewing.subscribe((value) => {
			isPreviewing = value;
		});
		newFile();
	});
</script>

<div data-popup="file-menu">
	<div class="btn-group-vertical mt-1 rounded border border-gray-300 bg-white shadow-lg">
		<button class="hover:bg-gray-100" on:click={newFile}>New</button>
		<button
			class="hover:bg-gray-100"
			on:click={() => document.getElementById('folder_upload')?.click()}>Import</button
		>
		<button class="hover:bg-gray-100" on:click={exportFile}>Export</button>
		<ChartFolderUpload {onFileUpload} hidden={true} />
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
		<div class="w-[25%] pt-4">
			<TabGroup border="">
				<Tab class="w-1/4 hover:bg-gray-100" bind:group={currentTab} name="main" value={0}
					>Main</Tab
				>
				{#if !isPreviewing}
					<Tab
						class="w-1/4 hover:bg-gray-100"
						bind:group={currentTab}
						name="sound"
						value={1}>Sound</Tab
					>
				{/if}
				<svelte:fragment slot="panel">
					{#if currentTab === 0}
						<MainTab />
					{:else if currentTab === 1}
						<SoundTab />
					{/if}
				</svelte:fragment>
			</TabGroup>
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
