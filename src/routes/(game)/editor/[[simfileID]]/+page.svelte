<script lang="ts">
	import { type Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@/game/main.svelte';
	import { goto } from '$app/navigation';
	import { Editor } from '@/game/scenes/Editor';
	import { onDestroy, onMount } from 'svelte';
	import MainTab from '$lib/components/editor/MainTab.svelte';
	import { DTXFile } from '$lib/chart/dtx';
	import { MainMenu } from '@/game/scenes/MainMenu';
	import SoundTab from '$lib/components/editor/SoundTab.svelte';
	import { get } from 'svelte/store';
	import ChartFolderUpload from '$lib/components/ChartFolderUpload.svelte';
	import { SimFile } from '$lib/chart/simFile';
	import EventType from '@/game/EventType';
	import store from '$lib/store';
	import { EventBus } from '@/game/EventBus';
	import { page } from '$app/state';
	import { FileUpload, Popover } from '@skeletonlabs/skeleton-svelte';

	let phaserRef: TPhaserRef = { game: null, scene: null };
	let currentTab: number = $state(0);
	let isPreviewing = $state(false);
	let simfileID: string;

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
		const bpmNotes = highestDtx.parseBPMChanges();
		const soundChips = highestDtx.parseSoundChips();
		soundChips.forEach((soundChip) => {
			soundChip.file = simfile.files.find((f) => f.name === soundChip.fileName);
		});
		store.currentDtxFile.set(highestDtx);
		store.currentSimfile.set(simfile);
		store.currentSoundChip.set(soundChips);
		EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);
	}

	onMount(async () => {
		store.activeScene.set(Editor.key);
		store.isPreviewing.subscribe((value) => {
			isPreviewing = value;
		});
		simfileID = page.params.simfileID;
		if (!simfileID) {
			newFile();
			return;
		}

		try {
			// Load simfile from remote URL
			const simfile = await SimFile.parseFromRemoteURL(simfileID);

			// Get the highest level DTX file from the simfile
			const highestDtx = simfile.getHighestLevel();

			// Parse notes and BPM changes
			const notes = highestDtx.parseNotes();
			const bpmNotes = highestDtx.parseBPMChanges();
			const soundChips = highestDtx.parseSoundChips();

			// Set the current DTX file and simfile in the store
			store.currentDtxFile.set(highestDtx);
			store.currentSimfile.set(simfile);
			store.currentSoundChip.set(soundChips);

			soundChips.forEach(async (soundChip) => {
				await soundChip.fetchRemote(simfileID);
			});

			// Emit note import event
			EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);
		} catch (error) {
			console.error('Error loading simfile:', error);
			newFile(); // Fallback to new file if loading fails
		}
	});
</script>

<div class="grid h-screen grid-cols-1 grid-rows-[auto_1fr]">
	<div class="relative row-span-1 flex flex-row items-center border-b-2 border-gray-400">
		<Popover
			positioning={{ placement: 'bottom-start' }}
			contentBase="p-0 z-50 rounded-sm border border-gray-300 bg-white shadow-lg"
			classes="w-1/12 rounded-sm bg-gray-200 py-2 hover:bg-gray-300"
			triggerClasses="w-full"
		>
			{#snippet trigger()}
				<span>File</span>
			{/snippet}
			{#snippet content()}
				<div class="flex flex-col">
					<button class="px-4 py-2 text-left hover:bg-gray-100" onclick={newFile}
						>New</button
					>
					<ChartFolderUpload {onFileUpload}>
						{#snippet button()}
							<button class="px-4 py-2 text-left hover:bg-gray-100">Import</button>
						{/snippet}
					</ChartFolderUpload>
					<button class="px-4 py-2 text-left hover:bg-gray-100" onclick={exportFile}
						>Export</button
					>
				</div>
			{/snippet}
		</Popover>
		<div class="h-8 border-l border-gray-300"></div>
	</div>

	<!-- Main content area - change to flex column on small screens, row on larger screens -->
	<div class="row-span-1 flex flex-col 2xl:flex-row">
		<!-- Left tab panel - full width on small screens, 25% on large screens -->
		<div class="w-full pt-4 2xl:w-[25%]">
			<div class="tab-container">
				<!-- Tab controls -->
				<div class="tab-list flex">
					<button
						class="w-[15%] px-4 py-2 hover:bg-gray-100 2xl:w-1/4 {currentTab === 0
							? 'bg-primary-500 text-white'
							: 'bg-gray-100'}"
						onclick={() => (currentTab = 0)}
					>
						Main
					</button>
					{#if !isPreviewing}
						<button
							class="w-[15%] px-4 py-2 hover:bg-gray-100 2xl:w-1/4 {currentTab === 1
								? 'bg-primary-500 text-white'
								: 'bg-gray-100'}"
							onclick={() => (currentTab = 1)}
						>
							Sound
						</button>
					{/if}
				</div>

				<!-- Tab panels -->
				<div class="tab-content mt-4">
					{#if currentTab === 0}
						<MainTab />
					{:else if currentTab === 1}
						<SoundTab />
					{/if}
				</div>
			</div>
		</div>

		<!-- Center game component - full width on small screens, 55% on large screens -->
		<div class="flex w-full justify-center p-5 2xl:w-[55%]">
			<Main {phaserRef} {currentActiveScene} />
		</div>

		<!-- Right button panel - full width on small screens, 20% on large screens -->
		<div
			class="flex w-full flex-col items-center justify-center p-4 2xl:w-[20%] 2xl:items-end 2xl:justify-end 2xl:p-16"
		>
			<button
				class="mt-5 w-full max-w-xs rounded-sm bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-hidden"
				onclick={() => {
					goto('/game');
					store.activeScene.set(MainMenu.key);
				}}>Game</button
			>
			<button
				class="mt-5 w-full max-w-xs rounded-sm bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-hidden"
				onclick={() => {
					goto('/');
					store.activeScene.set(null);
				}}>Main</button
			>
		</div>
	</div>
</div>
