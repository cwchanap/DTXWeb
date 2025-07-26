<script lang="ts">
	import { MainTab, SoundTab } from '@dtx/common/components';
	import { DTXFile, SoundChip } from '@dtx/common';
	import { onMount } from 'svelte';

	interface Props {
		dtxFile: DTXFile;
		availableCharts: any[];
		currentChartIndex: number;
		onBack?: () => void;
		onSwitchChart?: (index: number) => void;
	}

	let { dtxFile, availableCharts, currentChartIndex, onBack, onSwitchChart }: Props = $props();

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
	let isLeftPanelCollapsed = $state(false);
	let leftPanelWidth = $state(33); // percentage width
	let isResizing = $state(false);

	// Function to initialize/reinitialize from DTX file
	function initializeFromDtxFile() {
		if (dtxFile) {
			// Use existing sound chips if available, otherwise parse new ones
			soundChips = dtxFile.soundChips || dtxFile.parseSoundChips() || [];
			const filesWithAudio = soundChips.filter((chip) => chip.file).length;
			console.log(
				`Editor initialized with ${soundChips.length} sound chips (${filesWithAudio} with audio files)`
			);

			// Initialize measure count from DTX file or use default
			measureCount = 10; // Default measure count

			// Reset other states for clean chart switching
			activeNote = '01';
			keyBindings = {};
			isPreviewing = false;
			playSpeed = 1;
		}
	}

	// Initialize from DTX file on mount
	onMount(() => {
		initializeFromDtxFile();
	});

	// Track the current chart index to detect chart switches
	let previousChartIndex = $state(currentChartIndex);

	// Reinitialize when chart index changes (chart switch)
	$effect(() => {
		if (currentChartIndex !== previousChartIndex) {
			console.log(`Chart switched from ${previousChartIndex} to ${currentChartIndex}`);
			initializeFromDtxFile();
			previousChartIndex = currentChartIndex;
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
				// For local files, we need to get the audio data via IPC
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

					// Use IPC to read the audio file buffer
					const result = await window.electron.ipcRenderer.invoke(
						'read-audio-file',
						audioFilePath,
						currentWorkspaceState.selectedSong.path
					);

					if (result.error) {
						throw new Error(result.error);
					}

					// Check if it's an XA file and decode if necessary
					const isXAFile = file.toLowerCase().endsWith('.xa');
					let audioBuffer: Uint8Array;
					let mimeType: string;

					if (isXAFile) {
						// Import XA decoder (WASM already initialized globally)
						const { WasmXADecoder } = await import('xa_decoder');
						const decoder = new WasmXADecoder();

						// Decode XA data to PCM using Web Audio API (like dtx-web)
						const rawBuffer = new Uint8Array(result.buffer);
						const decodedData = decoder.decode(rawBuffer);
						const format = decoder.get_format();

						// Create AudioContext and AudioBuffer (like dtx-web)
						const audioContext = new AudioContext();
						const audioBuffer = audioContext.createBuffer(
							format.channels,
							decodedData.length,
							format.samples_rate
						);

						// Copy PCM data to AudioBuffer channels
						for (let i = 0; i < format.channels; i++) {
							const channelData = audioBuffer.getChannelData(i);
							for (let j = 0; j < decodedData.length; j++) {
								channelData[j] = decodedData[j] / 32768; // Same normalization as web
							}
						}

						// Play via Web Audio API (like dtx-web)
						const source = audioContext.createBufferSource();
						const gainNode = audioContext.createGain();

						source.buffer = audioBuffer;
						gainNode.gain.value = volume / 100;

						source.connect(gainNode);
						gainNode.connect(audioContext.destination);
						source.start();
					} else {
						// For non-XA files, use the existing blob URL approach
						audioBuffer = new Uint8Array(result.buffer);
						mimeType = result.mimeType;

						// Create blob from buffer and generate blob URL
						const blob = new Blob([audioBuffer], { type: mimeType });
						const audioUrl = URL.createObjectURL(blob);

						// Use HTML5 Audio API to play the blob URL
						const audio = new Audio(audioUrl);
						audio.volume = volume / 100; // Convert percentage to decimal

						// Clean up the blob URL after playback
						audio.onended = () => URL.revokeObjectURL(audioUrl);
						audio.onerror = () => URL.revokeObjectURL(audioUrl);

						await audio.play();
					}
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

	function handleSave() {
		if (dtxFile) {
			// In desktop app, we can save directly to file system
			showToastMessage('Save functionality to be implemented', 'warning');
		}
	}

	function toggleLeftPanel() {
		isLeftPanelCollapsed = !isLeftPanelCollapsed;
	}

	function handleResizeStart(event: MouseEvent) {
		if (isLeftPanelCollapsed) return;

		isResizing = true;
		event.preventDefault();

		const startX = event.clientX;
		const startWidth = leftPanelWidth;
		const containerWidth = window.innerWidth;

		function handleMouseMove(e: MouseEvent) {
			if (!isResizing) return;

			const deltaX = e.clientX - startX;
			const deltaPercent = (deltaX / containerWidth) * 100;
			const newWidth = Math.max(15, Math.min(60, startWidth + deltaPercent)); // Min 15%, Max 60%

			leftPanelWidth = newWidth;
		}

		function handleMouseUp() {
			isResizing = false;
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		}

		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);
	}
</script>

<div
	class="flex h-screen flex-col bg-white dark:bg-slate-800 {isResizing
		? 'cursor-col-resize select-none'
		: ''}"
>
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
				{dtxFile?.title || 'Untitled'} - Level {dtxFile?.level || 0}
			</h1>
		</div>
		<div class="flex items-center space-x-2">
			<!-- Chart Switcher -->
			{#if availableCharts.length > 1}
				<div class="relative">
					<select
						class="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700"
						value={currentChartIndex}
						onchange={(e) => onSwitchChart?.(parseInt(e.target.value))}
						disabled={isPreviewing}
					>
						{#each availableCharts as chart, index}
							<option value={index}>
								{chart.title} (Lv.{chart.level})
							</option>
						{/each}
					</select>
				</div>
			{/if}
			<button
				onclick={handleSave}
				class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
				disabled={isPreviewing}
			>
				Save
			</button>
		</div>
	</div>

	<!-- Main content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Left panel with tabs -->
		<div
			class="relative flex flex-col border-r border-gray-200 dark:border-slate-600 {isResizing
				? ''
				: 'transition-all duration-300'}"
			style="width: {isLeftPanelCollapsed ? '3rem' : `${leftPanelWidth}%`}"
		>
			<!-- Tab headers -->
			<div class="flex border-b border-gray-200 dark:border-slate-600">
				{#if !isLeftPanelCollapsed}
					<nav class="flex flex-1">
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
				{/if}
				<!-- Collapse/Expand button -->
				<button
					onclick={toggleLeftPanel}
					class="px-3 py-3 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-gray-100"
					title={isLeftPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
				>
					{#if isLeftPanelCollapsed}
						→
					{:else}
						←
					{/if}
				</button>
			</div>

			<!-- Tab content -->
			{#if !isLeftPanelCollapsed}
				<div class="h-full overflow-auto p-4">
					{#if currentTab === 0}
						{#key currentChartIndex}
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
						{/key}
					{:else if currentTab === 1}
						{#key currentChartIndex}
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
						{/key}
					{/if}
				</div>
			{/if}

			<!-- Resize handle -->
			{#if !isLeftPanelCollapsed}
				<div
					class="hover:bg-opacity-30 group absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize bg-transparent transition-colors duration-200 hover:bg-blue-500"
					onmousedown={handleResizeStart}
					title="Drag to resize"
				>
					<!-- Visual indicator dots -->
					<div
						class="absolute inset-y-0 right-0 w-1 bg-gray-300 opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-slate-500"
					>
						<div
							class="absolute top-1/2 left-0 h-8 w-1 -translate-y-1/2 transform rounded-full bg-gray-400 dark:bg-slate-400"
						></div>
					</div>
				</div>
			{/if}
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
