<script lang="ts">
	import { goto } from '$app/navigation';
	import { locale, locales } from 'svelte-i18n';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import toastStore from '$lib/toaster';
	import { DTXFile } from '@dtx/common';

	const localeMap: Record<string, string> = {
		en: 'English',
		jp: '日本語'
	};

	let languagePopoverOpen = $state(false);
	let uploadedFile = $state<File | null>(null);
	let isConverting = $state(false);
	let isConverted = $state(false);
	let convertedFileName = $state<string>('');
	let dtxFile = $state<DTXFile | null>(null);

	// Default lane to MIDI channel mapping
	let laneChannelMap = $state<Record<string, number>>({
		'01': 9, // Bass Drum -> Drum channel
		'02': 9, // Snare -> Drum channel
		'03': 9, // Closed Hi-Hat -> Drum channel
		'04': 9, // Open Hi-Hat -> Drum channel
		'05': 9, // Crash Cymbal -> Drum channel
		'06': 9, // Ride Cymbal -> Drum channel
		'07': 9, // Low Tom -> Drum channel
		'08': 9, // Mid Tom -> Drum channel
		'09': 9, // High Tom -> Drum channel
		'0A': 9, // Pedal Hi-Hat -> Drum channel
		'0B': 9, // Crash 2 -> Drum channel
		'0C': 9 // Ride 2 -> Drum channel
	});

	let fileInput: HTMLInputElement;

	const handleFileUpload = (event: Event) => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];

		if (
			file &&
			(file.name.toLowerCase().endsWith('.dtx') || file.name.toLowerCase().endsWith('.txt'))
		) {
			uploadedFile = file;
			isConverted = false;
		} else if (file) {
			toastStore.error({
				title: 'Invalid file type',
				description: 'Please select a valid DTX file (.dtx)',
				duration: 3000
			});
			target.value = '';
		}
	};

	const handleUploadClick = () => {
		fileInput?.click();
	};

	const handleConvert = async () => {
		if (!uploadedFile) return;

		isConverting = true;

		try {
			// Parse the DTX file
			dtxFile = new DTXFile(uploadedFile);
			await dtxFile.parse();

			const baseName = uploadedFile.name.replace(/\.[^/.]+$/, '');
			convertedFileName = `${baseName}.mid`;
			isConverting = false;
			isConverted = true;
		} catch (error) {
			isConverting = false;
			toastStore.error({
				title: 'Conversion failed',
				description: `Failed to parse DTX file: ${error instanceof Error ? error.message : 'Unknown error'}`,
				duration: 5000
			});
		}
	};

	const handleDownload = () => {
		if (!dtxFile || !isConverted) return;

		try {
			// Parse notes from DTX file and convert to MIDI
			const notes = dtxFile.parseNotes();
			const notesByLane: Record<string, any[]> = {};

			// Group notes by lane
			notes.forEach((note) => {
				if (!notesByLane[note.laneID]) {
					notesByLane[note.laneID] = [];
				}
				notesByLane[note.laneID].push(note);
			});

			// Export to MIDI using our custom converter
			const midiData = dtxFile.exportToMidi(notesByLane, laneChannelMap);

			// Create blob and download
			const blob = new Blob([midiData], { type: 'audio/midi' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = convertedFileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			toastStore.success({
				title: 'Success',
				description: 'MIDI file downloaded successfully!',
				duration: 3000
			});
		} catch (error) {
			toastStore.error({
				title: 'Download failed',
				description: `Failed to generate MIDI file: ${error instanceof Error ? error.message : 'Unknown error'}`,
				duration: 5000
			});
		}
	};

	const handleReset = () => {
		uploadedFile = null;
		isConverted = false;
		isConverting = false;
		convertedFileName = '';
		dtxFile = null;
		if (fileInput) {
			fileInput.value = '';
		}
	};

	const handleBack = () => {
		goto('/tool');
	};
</script>

<div class="min-h-screen bg-gray-100">
	<header class="bg-indigo-600">
		<div class="container mx-auto flex items-center justify-between px-4 py-6">
			<div class="flex items-center gap-4">
				<button
					class="text-white transition-colors hover:text-gray-200"
					onclick={handleBack}
				>
					← Back to Tools
				</button>
				<h1 class="text-3xl font-bold text-white">DTX to MIDI Converter</h1>
			</div>
			<Popover
				open={languagePopoverOpen}
				onOpenChange={(details) => (languagePopoverOpen = details.open)}
				positioning={{ placement: 'top' }}
				triggerBase="rounded-sm bg-indigo-500 px-4 py-2 text-white hover:bg-indigo-700"
				contentBase="card bg-surface-200-800 space-y-4 max-w-[320px]"
				arrow
				arrowBackground="!bg-surface-200 dark:!bg-surface-800"
			>
				{#snippet trigger()}
					Change Language
				{/snippet}
				{#snippet content()}
					<div class="mt-1 rounded-sm border border-gray-300 bg-white shadow-lg">
						{#each $locales as l}
							<button
								class="w-full p-2 text-left hover:bg-gray-100"
								onclick={() => locale.set(l)}
							>
								{localeMap[l]}
							</button>
						{/each}
					</div>
				{/snippet}
			</Popover>
		</div>
	</header>

	<main class="container mx-auto max-w-4xl px-4 py-8">
		<div class="rounded-lg border border-gray-300 bg-white p-8 shadow-sm">
			<h2 class="mb-6 text-2xl font-bold text-gray-900">Convert DTX to MIDI</h2>

			<div class="space-y-6">
				<!-- Upload Section -->
				<div class="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
					{#if !uploadedFile}
						<div class="space-y-4">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100"
							>
								<svg
									class="h-6 w-6 text-indigo-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
									/>
								</svg>
							</div>
							<div>
								<h3 class="text-lg font-medium text-gray-900">Upload DTX File</h3>
								<p class="text-gray-600">Select a .dtx file to convert</p>
							</div>
							<button
								type="button"
								class="rounded-md bg-indigo-600 px-6 py-3 font-medium text-white transition-colors hover:bg-indigo-700"
								onclick={handleUploadClick}
							>
								Choose File
							</button>
						</div>
					{:else}
						<div class="space-y-4">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100"
							>
								<svg
									class="h-6 w-6 text-green-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
									/>
								</svg>
							</div>
							<div>
								<h3 class="text-lg font-medium text-gray-900">File Ready</h3>
								<p class="text-gray-600">{uploadedFile.name}</p>
								<p class="text-sm text-gray-500">
									{(uploadedFile.size / 1024).toFixed(1)} KB
								</p>
							</div>
							<div class="flex justify-center gap-3">
								<button
									type="button"
									class="rounded-md bg-red-600 px-4 py-2 font-medium text-white transition-colors hover:bg-red-700"
									onclick={handleReset}
								>
									Remove
								</button>
								<button
									type="button"
									class="rounded-md bg-gray-600 px-4 py-2 font-medium text-white transition-colors hover:bg-gray-700"
									onclick={handleUploadClick}
								>
									Choose Different File
								</button>
							</div>
						</div>
					{/if}

					<input
						bind:this={fileInput}
						type="file"
						accept=".dtx,.txt"
						onchange={handleFileUpload}
						class="hidden"
					/>
				</div>

				<!-- Lane Mapping Section -->
				{#if uploadedFile}
					<div class="rounded-lg border border-gray-300 bg-gray-50 p-6">
						<h3 class="mb-4 text-lg font-semibold text-gray-900">
							DTX Lane to MIDI Channel Mapping
						</h3>
						<p class="mb-4 text-sm text-gray-600">
							Configure which MIDI channel each DTX lane should map to (0-15, with 9
							being the standard drum channel):
						</p>

						<div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
							{#each Object.entries(laneChannelMap) as [lane]}
								<div class="flex items-center space-x-2">
									<label
										for="lane-{lane}"
										class="min-w-[3rem] text-sm font-medium text-gray-700"
										>{lane}:</label
									>
									<input
										id="lane-{lane}"
										type="number"
										min="0"
										max="15"
										bind:value={laneChannelMap[lane]}
										class="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
									/>
									<span class="text-xs text-gray-500">
										{#if lane === '01'}Bass Drum{:else if lane === '02'}Snare{:else if lane === '03'}Closed
											Hi-Hat{:else if lane === '04'}Open Hi-Hat{:else if lane === '05'}Crash{:else if lane === '06'}Ride{:else if lane === '07'}Low
											Tom{:else if lane === '08'}Mid Tom{:else if lane === '09'}High
											Tom{:else if lane === '0A'}Pedal Hi-Hat{:else if lane === '0B'}Crash
											2{:else if lane === '0C'}Ride 2{:else}Unknown{/if}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Convert Section -->
				{#if uploadedFile}
					<div class="flex justify-center">
						<button
							type="button"
							class="flex items-center gap-2 rounded-md bg-indigo-600 px-8 py-3 font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-400"
							onclick={handleConvert}
							disabled={isConverting || isConverted}
						>
							{#if isConverting}
								<div
									class="h-4 w-4 animate-spin rounded-full border-b-2 border-white"
								></div>
								Converting...
							{:else if isConverted}
								✓ Converted
							{:else}
								Convert to MIDI
							{/if}
						</button>
					</div>
				{/if}

				<!-- Download Section -->
				{#if isConverted}
					<div class="rounded-lg border-2 border-green-300 bg-green-50 p-6">
						<div class="space-y-4 text-center">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100"
							>
								<svg
									class="h-6 w-6 text-green-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
									/>
								</svg>
							</div>
							<div>
								<h3 class="text-lg font-medium text-green-900">
									Conversion Complete!
								</h3>
								<p class="text-green-700">Your MIDI file is ready for download</p>
								<p class="text-sm text-green-600">{convertedFileName}</p>
							</div>
							<div class="flex justify-center gap-3">
								<button
									type="button"
									class="rounded-md bg-green-600 px-6 py-3 font-medium text-white transition-colors hover:bg-green-700"
									onclick={handleDownload}
								>
									Download MIDI File
								</button>
								<button
									type="button"
									class="rounded-md bg-gray-600 px-4 py-2 font-medium text-white transition-colors hover:bg-gray-700"
									onclick={handleReset}
								>
									Convert Another File
								</button>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Info Section -->
		<div class="mt-8 rounded-lg border border-gray-300 bg-white p-6 shadow-sm">
			<h3 class="mb-3 text-lg font-semibold text-gray-900">About DTX to MIDI Conversion</h3>
			<div class="space-y-2 text-gray-700">
				<p>
					This tool converts DTX drum chart files to MIDI format for use with digital
					audio workstations and other music software.
				</p>
				<p><strong>Supported input:</strong> .dtx files</p>
				<p><strong>Output:</strong> .mid files compatible with any MIDI-capable software</p>
				<p>
					<strong>Features:</strong> Configurable lane-to-channel mapping, proper timing conversion,
					and General MIDI drum mapping.
				</p>
			</div>
		</div>
	</main>
</div>
