<script lang="ts">
	import { MainTab, SoundTab } from '@dtx/common/components';
	import { DTXFile, SoundChip } from '@dtx/common';
	import { onMount } from 'svelte';

	interface Props {
		dtxFile: DTXFile;
		onBack?: () => void;
	}

	let { dtxFile, onBack }: Props = $props();

	// State for tab components
	let currentTab = $state(0);
	let measureCount = $state(10);
	let isPreviewing = $state(false);
	let playSpeed = $state(1);
	let soundChips = $state<SoundChip[]>([]);
	let activeNote = $state('01');
	let keyBindings = $state<Record<string, string>>({});
	let showToast = $state(false);
	let toastMessage = $state('');
	let toastType: 'warning' | 'error' = $state('warning');

	// Initialize from DTX file
	onMount(() => {
		if (dtxFile) {
			// Parse and initialize all DTX data
			soundChips = dtxFile.parseSoundChips() || [];

			// Initialize measure count from DTX file or use default
			measureCount = 10; // Default measure count
		}
	});

	// Callback functions for tab components
	function handleDtxFileChange(file: DTXFile) {
		dtxFile = file;
		// In desktop app, we could save to file system here
	}

	function handleMeasureChange(count: number) {
		measureCount = count;
	}

	function handlePlaySpeedChange(speed: number) {
		playSpeed = speed;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	function handleGotoMeasure(_measure: number) {
		// In desktop app, this could scroll to the specific measure
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	function handlePreviewToggle(isPlaying: boolean, _bpm: number) {
		isPreviewing = isPlaying;
		// In desktop app, this could start/stop audio playback
	}

	function handleSoundChipsChange(chips: SoundChip[]) {
		soundChips = chips;
	}

	function handleActiveNoteChange(noteId: string) {
		activeNote = noteId;
	}

	function handleKeyBindingsChange(bindings: Record<string, string>) {
		keyBindings = bindings;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async function handlePlayAudio(file: string | File, volume: number, _chip?: SoundChip) {
		try {
			if (typeof file === 'string') {
				// For local files, we need to resolve the path relative to the DTX file location
				// Get the workspace path to find the song directory
				let currentWorkspaceState: any = null;
				const { workspaceStore } = await import('../stores/workspaceStore');
				const unsubscribe = workspaceStore.subscribe((state) => {
					currentWorkspaceState = state;
				});
				unsubscribe();

				if (currentWorkspaceState?.selectedSong?.path) {
					// Construct the full path to the audio file
					const audioFilePath = `${currentWorkspaceState.selectedSong.path}/${file}`;

					// Use HTML5 Audio API to play the file
					const audio = new Audio(`file://${audioFilePath}`);
					audio.volume = volume / 100; // Convert percentage to decimal
					await audio.play();
				} else {
					showToastMessage('Cannot determine song directory for audio playback', 'error');
				}
			} else if (file instanceof File) {
				// For File objects, create a blob URL and play
				const audioUrl = URL.createObjectURL(file);
				const audio = new Audio(audioUrl);
				audio.volume = volume / 100;

				// Clean up the blob URL after playback
				audio.onended = () => URL.revokeObjectURL(audioUrl);
				audio.onerror = () => URL.revokeObjectURL(audioUrl);

				await audio.play();
			}
		} catch (error) {
			console.error('Audio playback failed:', error);
			showToastMessage(
				`Audio playback failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'error'
			);
		}
	}

	function showToastMessage(message: string, type: 'warning' | 'error' = 'warning') {
		toastMessage = message;
		toastType = type;
		showToast = true;
		// Auto-hide toast after 4 seconds
		setTimeout(() => {
			showToast = false;
		}, 4000);
	}

	function handleExport() {
		if (dtxFile) {
			// In desktop app, we can save directly to file system
			showToastMessage('Export functionality to be implemented', 'warning');
		}
	}

	function handleSave() {
		if (dtxFile) {
			// In desktop app, we can save directly to file system
			showToastMessage('Save functionality to be implemented', 'warning');
		}
	}
</script>

<div class="flex h-screen flex-col bg-white dark:bg-slate-800">
	<!-- Header -->
	<div
		class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-slate-600"
	>
		<div class="flex items-center space-x-4">
			<button
				onclick={onBack}
				class="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
			>
				← Back to Workspace
			</button>
			<h1 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
				Editor - {dtxFile?.title || 'Untitled'}
			</h1>
		</div>
		<div class="flex items-center space-x-2">
			<button
				onclick={handleSave}
				class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
				disabled={isPreviewing}
			>
				Save
			</button>
			<button
				onclick={handleExport}
				class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
				disabled={isPreviewing}
			>
				Export
			</button>
		</div>
	</div>

	<!-- Main content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Left panel with tabs -->
		<div class="w-1/3 border-r border-gray-200 dark:border-slate-600">
			<!-- Tab headers -->
			<div class="border-b border-gray-200 dark:border-slate-600">
				<nav class="flex">
					<button
						class="px-6 py-3 text-sm font-medium {currentTab === 0
							? 'border-b-2 border-blue-500 text-blue-600'
							: 'text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100'}"
						onclick={() => (currentTab = 0)}
					>
						Main
					</button>
					<button
						class="px-6 py-3 text-sm font-medium {currentTab === 1
							? 'border-b-2 border-blue-500 text-blue-600'
							: 'text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100'}"
						onclick={() => (currentTab = 1)}
					>
						Sound
					</button>
				</nav>
			</div>

			<!-- Tab content -->
			<div class="h-full overflow-auto p-4">
				{#if currentTab === 0}
					<MainTab
						bind:dtxFile
						bind:measureCount
						bind:isPreviewing
						bind:playSpeed
						onDtxFileChange={handleDtxFileChange}
						onMeasureChange={handleMeasureChange}
						onPlaySpeedChange={handlePlaySpeedChange}
						onGotoMeasure={handleGotoMeasure}
						onPreviewToggle={handlePreviewToggle}
					/>
				{:else if currentTab === 1}
					<SoundTab
						bind:soundChips
						bind:activeNote
						bind:keyBindings
						isRemoteChart={false}
						onSoundChipsChange={handleSoundChipsChange}
						onActiveNoteChange={handleActiveNoteChange}
						onKeyBindingsChange={handleKeyBindingsChange}
						onPlayAudio={handlePlayAudio}
						onShowToast={showToastMessage}
					/>
				{/if}
			</div>
		</div>

		<!-- Right panel - Editor area placeholder -->
		<div class="flex flex-1 items-center justify-center bg-gray-50 dark:bg-slate-900">
			<div class="text-center">
				<div class="mb-4 text-6xl text-gray-300 dark:text-slate-600">🎵</div>
				<h2 class="mb-2 text-xl font-medium text-gray-600 dark:text-gray-300">
					Visual Editor Coming Soon
				</h2>
				<p class="text-gray-500 dark:text-gray-400">
					The Phaser-based visual editor will be integrated here.
					<br />
					For now, use the Main and Sound tabs to edit DTX metadata and sounds.
				</p>
			</div>
		</div>
	</div>
</div>

<!-- Toast notifications -->
{#if showToast}
	<div
		class="fixed top-4 right-4 z-50 w-full max-w-sm"
		role="alert"
		aria-live="polite"
		aria-atomic="true"
	>
		<div
			class="flex items-center rounded-lg p-4 shadow-lg {toastType === 'error'
				? 'border-red-200 bg-red-50 text-red-800'
				: 'border-yellow-200 bg-yellow-50 text-yellow-800'} border"
		>
			<div class="flex-shrink-0">
				{#if toastType === 'error'}
					<svg
						class="h-5 w-5 text-red-400"
						fill="currentColor"
						viewBox="0 0 20 20"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
							clip-rule="evenodd"
						/>
					</svg>
				{:else}
					<svg
						class="h-5 w-5 text-yellow-400"
						fill="currentColor"
						viewBox="0 0 20 20"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
							clip-rule="evenodd"
						/>
					</svg>
				{/if}
			</div>
			<div class="ml-3 flex-1">
				<p class="text-sm font-medium">{toastMessage}</p>
			</div>
			<button
				type="button"
				class="-mx-1.5 -my-1.5 ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg p-1.5 {toastType ===
				'error'
					? 'text-red-500 hover:bg-red-100'
					: 'text-yellow-500 hover:bg-yellow-100'} focus:ring-2 focus:ring-offset-2 {toastType ===
				'error'
					? 'focus:ring-red-500'
					: 'focus:ring-yellow-500'}"
				onclick={() => (showToast = false)}
				aria-label="Close"
			>
				<span class="sr-only">Close</span>
				<svg class="h-3 w-3" aria-hidden="true" fill="none" viewBox="0 0 14 14">
					<path
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"
					/>
				</svg>
			</button>
		</div>
	</div>
{/if}
