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

	// Default lane to MIDI note mapping (General MIDI drum map)
	let laneNoteMap = $state<Record<string, number>>({
		'01': 36, // Bass Drum
		'02': 38, // Snare
		'03': 42, // Closed Hi-Hat
		'04': 46, // Open Hi-Hat
		'05': 49, // Crash Cymbal
		'06': 51, // Ride Cymbal
		'07': 45, // Low Tom
		'08': 47, // Mid Tom
		'09': 50, // High Tom
		'0A': 44, // Pedal Hi-Hat
		'0B': 57, // Crash 2
		'0C': 59 // Ride 2
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
			const midiData = dtxFile.exportToMidi(notesByLane, laneNoteMap);

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

<div class="relative min-h-screen overflow-hidden" style="background: var(--music-bg-primary);">
	<!-- Animated background elements -->
	<div class="absolute inset-0 opacity-20">
		<div
			class="absolute top-20 left-10 h-32 w-32 animate-pulse rounded-full bg-gradient-to-br from-purple-500 to-pink-500 blur-xl"
		></div>
		<div
			class="absolute top-40 right-20 h-24 w-24 animate-pulse rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 blur-lg"
			style="animation-delay: 1s;"
		></div>
		<div
			class="absolute bottom-20 left-1/3 h-40 w-40 animate-pulse rounded-full bg-gradient-to-br from-amber-500 to-orange-500 blur-2xl"
			style="animation-delay: 2s;"
		></div>
	</div>
	<header class="music-nav relative z-10">
		<div class="container mx-auto flex items-center justify-between px-6 py-8">
			<div class="flex items-center gap-4">
				<button class="music-btn-secondary px-3 py-2 text-sm" onclick={handleBack}>
					← Back to Tools
				</button>
				<h1
					class="bg-gradient-to-r from-purple-400 via-cyan-400 to-amber-400 bg-clip-text text-4xl font-bold text-transparent"
				>
					DTX to MIDI Converter
				</h1>
				<div class="music-bars">
					<div class="music-bar" style="height: 8px;"></div>
					<div class="music-bar" style="height: 16px;"></div>
					<div class="music-bar" style="height: 12px;"></div>
					<div class="music-bar" style="height: 20px;"></div>
					<div class="music-bar" style="height: 6px;"></div>
				</div>
			</div>
			<Popover
				open={languagePopoverOpen}
				onOpenChange={(details) => (languagePopoverOpen = details.open)}
				positioning={{ placement: 'top' }}
				triggerBase="music-btn-secondary px-4 py-2 text-sm"
				contentBase="card bg-surface-200-800 space-y-4 max-w-[320px]"
				arrow
				arrowBackground="!bg-surface-200 dark:!bg-surface-800"
			>
				{#snippet trigger()}
					Change Language
				{/snippet}
				{#snippet content()}
					<div class="rounded-lg border border-purple-500/30 bg-slate-800 shadow-xl">
						{#each $locales as l}
							<button
								class="w-full p-3 text-left text-slate-300 transition-colors duration-200 first:rounded-t-lg last:rounded-b-lg hover:bg-purple-600/20 hover:text-purple-200"
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

	<main class="relative z-0 container mx-auto max-w-4xl px-6 py-16">
		<div class="music-card p-8">
			<h2
				class="mb-6 bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-3xl font-bold text-transparent"
			>
				Convert DTX to MIDI
			</h2>

			<div class="space-y-6">
				<!-- Upload Section -->
				<div
					class="rounded-lg border-2 border-dashed border-purple-500/30 bg-slate-800/50 p-8 text-center"
				>
					{#if !uploadedFile}
						<div class="space-y-4">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/20"
							>
								<svg
									class="h-6 w-6 text-purple-400"
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
								<h3 class="text-lg font-medium text-slate-200">Upload DTX File</h3>
								<p class="text-slate-300">Select a .dtx file to convert</p>
							</div>
							<button
								type="button"
								class="music-btn-primary"
								onclick={handleUploadClick}
							>
								Choose File
							</button>
						</div>
					{:else}
						<div class="space-y-4">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/20"
							>
								<svg
									class="h-6 w-6 text-purple-400"
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
								<h3 class="text-lg font-medium text-slate-200">File Ready</h3>
								<p class="text-slate-300">{uploadedFile.name}</p>
								<p class="text-sm text-slate-400">
									{(uploadedFile.size / 1024).toFixed(1)} KB
								</p>
							</div>
							<div class="flex justify-center gap-3">
								<button
									type="button"
									class="music-btn-secondary"
									onclick={handleReset}
								>
									Remove
								</button>
								<button
									type="button"
									class="music-btn-secondary"
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
					<div class="music-card p-6">
						<h3 class="mb-4 text-lg font-semibold text-slate-200">
							DTX Lane to MIDI Note Mapping
						</h3>
						<p class="mb-4 text-sm text-slate-300">
							Configure which MIDI note number each DTX lane should map to (General
							MIDI drum notes, 0-127):
						</p>

						<div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
							{#each Object.entries(laneNoteMap) as [lane]}
								<div class="flex items-center space-x-2">
									<label
										for="lane-{lane}"
										class="min-w-[3rem] text-sm font-medium text-slate-300"
										>{lane}:</label
									>
									<input
										id="lane-{lane}"
										type="number"
										min="0"
										max="127"
										bind:value={laneNoteMap[lane]}
										class="w-16 rounded border border-purple-500/30 bg-slate-800/50 px-2 py-1 text-sm text-slate-200 focus:border-purple-400 focus:ring-1 focus:ring-purple-400 focus:outline-none"
									/>
									<span class="text-xs text-slate-400">
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
							class="music-btn-primary flex items-center gap-2 px-8 py-3 disabled:cursor-not-allowed disabled:opacity-50"
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
					<div class="rounded-lg border-2 border-purple-500/30 bg-slate-800/50 p-6">
						<div class="space-y-4 text-center">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-500/20 to-cyan-500/20"
							>
								<svg
									class="h-6 w-6 text-purple-400"
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
								<h3
									class="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-lg font-medium text-transparent"
								>
									Conversion Complete!
								</h3>
								<p class="text-slate-200">Your MIDI file is ready for download</p>
								<p class="text-sm text-slate-300">{convertedFileName}</p>
							</div>
							<div class="flex justify-center gap-3">
								<button
									type="button"
									class="music-btn-primary px-6 py-3"
									onclick={handleDownload}
								>
									Download MIDI File
								</button>
								<button
									type="button"
									class="music-btn-secondary px-4 py-2"
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
		<div class="music-card mt-8 p-6">
			<h3 class="mb-3 text-lg font-semibold text-slate-200">About DTX to MIDI Conversion</h3>
			<div class="space-y-2 text-slate-300">
				<p>
					This tool converts DTX drum chart files to MIDI format for use with digital
					audio workstations and other music software.
				</p>
				<p><strong class="text-purple-400">Supported input:</strong> .dtx files</p>
				<p>
					<strong class="text-purple-400">Output:</strong> .mid files compatible with any MIDI-capable
					software
				</p>
				<p>
					<strong class="text-purple-400">Features:</strong> Configurable lane-to-note mapping,
					proper timing conversion, and General MIDI drum channel output (Channel 9).
				</p>
			</div>
		</div>
	</main>
</div>
