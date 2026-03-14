<script lang="ts">
	import { goto } from '$app/navigation';
	import { locale, locales } from 'svelte-i18n';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import toastStore from '$lib/toaster';
	import { DTXFile, LaneMeasureNote } from '@dtx/common';

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
	let convertedNotes = $state<Record<string, LaneMeasureNote[]> | null>(null);

	// MIDI note to DTX lane mapping (customizable)
	let midiToDtxMap = $state<Record<number, string>>({
		36: '01', // Bass Drum
		38: '02', // Snare
		42: '03', // Closed Hi-Hat
		46: '04', // Open Hi-Hat
		49: '05', // Crash Cymbal
		51: '06', // Ride Cymbal
		45: '07', // Low Tom
		47: '08', // Mid Tom
		50: '09', // High Tom
		44: '0A', // Pedal Hi-Hat
		57: '0B', // Crash 2
		59: '0C' // Ride 2
	});

	// DTX metadata settings
	let title = $state('Converted from MIDI');
	let artist = $state('Unknown');
	let level = $state(5);
	let bpm = $state(120);
	let comment = $state('Converted from MIDI file');

	let fileInput: HTMLInputElement;

	const handleFileUpload = (event: Event) => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];

		if (
			file &&
			(file.name.toLowerCase().endsWith('.mid') || file.name.toLowerCase().endsWith('.midi'))
		) {
			uploadedFile = file;
			isConverted = false;
			// Set default title from filename
			title = file.name.replace(/\.[^/.]+$/, '');
		} else if (file) {
			toastStore.error({
				title: 'Invalid file type',
				description: 'Please select a valid MIDI file (.mid or .midi)',
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
			// Parse the MIDI file
			dtxFile = new DTXFile();
			await dtxFile.parseFromMidi(uploadedFile);

			const parsedDtxFile = dtxFile;
			// Override metadata with user settings
			parsedDtxFile.title = title;
			parsedDtxFile.artist = artist;
			parsedDtxFile.level = level;
			parsedDtxFile.comment = comment;

			// Parse MIDI file again to get the raw data for note conversion
			const arrayBuffer = await uploadedFile.arrayBuffer();
			const data = new Uint8Array(arrayBuffer);
			const midiData = parsedDtxFile.parseMidiForConversion(data);

			// Override BPM if detected from MIDI
			if (parsedDtxFile.bpm && parsedDtxFile.bpm !== 120) {
				bpm = parsedDtxFile.bpm;
			} else {
				parsedDtxFile.bpm = bpm;
			}

			// Convert MIDI notes to DTX format
			convertedNotes = parsedDtxFile.convertMidiNotesToDtx(midiData);

			const baseName = uploadedFile.name.replace(/\.[^/.]+$/, '');
			convertedFileName = `${baseName}.dtx`;
			isConverting = false;
			isConverted = true;
		} catch (error) {
			isConverting = false;
			toastStore.error({
				title: 'Conversion failed',
				description: `Failed to parse MIDI file: ${error instanceof Error ? error.message : 'Unknown error'}`,
				duration: 5000
			});
		}
	};

	const handleDownload = async () => {
		if (!dtxFile || !isConverted || !convertedNotes) return;

		try {
			// Update DTX file with current metadata
			dtxFile.title = title;
			dtxFile.artist = artist;
			dtxFile.level = level;
			dtxFile.bpm = bpm;
			dtxFile.comment = comment;

			// Export DTX file with converted notes
			await dtxFile.export(convertedNotes);

			toastStore.success({
				title: 'Success',
				description: 'DTX file downloaded successfully!',
				duration: 3000
			});
		} catch (error) {
			toastStore.error({
				title: 'Download failed',
				description: `Failed to generate DTX file: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
		convertedNotes = null;
		title = 'Converted from MIDI';
		artist = 'Unknown';
		level = 5;
		bpm = 120;
		comment = 'Converted from MIDI file';
		if (fileInput) {
			fileInput.value = '';
		}
	};

	const handleBack = () => {
		goto('/tool');
	};

	// Get drum name from MIDI note number
	const getDrumName = (noteNumber: number): string => {
		const drumNames: Record<number, string> = {
			36: 'Bass Drum',
			38: 'Snare',
			42: 'Closed Hi-Hat',
			46: 'Open Hi-Hat',
			49: 'Crash Cymbal',
			51: 'Ride Cymbal',
			45: 'Low Tom',
			47: 'Mid Tom',
			50: 'High Tom',
			44: 'Pedal Hi-Hat',
			57: 'Crash 2',
			59: 'Ride 2'
		};
		return drumNames[noteNumber] || `Note ${noteNumber}`;
	};

	// Get DTX lane name
	const getLaneName = (laneId: string): string => {
		const laneNames: Record<string, string> = {
			'01': 'Bass Drum',
			'02': 'Snare',
			'03': 'Closed Hi-Hat',
			'04': 'Open Hi-Hat',
			'05': 'Crash Cymbal',
			'06': 'Ride Cymbal',
			'07': 'Low Tom',
			'08': 'Mid Tom',
			'09': 'High Tom',
			'0A': 'Pedal Hi-Hat',
			'0B': 'Crash 2',
			'0C': 'Ride 2'
		};
		return laneNames[laneId] || `Lane ${laneId}`;
	};

	// Available DTX lanes for mapping
	const availableLanes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '0A', '0B', '0C'];
</script>

<div class="min-h-screen" style="background: var(--music-bg-primary);">
	<!-- Animated Background Elements -->
	<div class="music-bg-orbs">
		<div class="music-orb-1"></div>
		<div class="music-orb-2"></div>
		<div class="music-orb-3"></div>
	</div>
	<header class="music-nav relative z-10">
		<div class="container mx-auto flex items-center justify-between px-4 py-6">
			<div class="flex items-center gap-4">
				<button
					class="text-slate-200 transition-all duration-300 hover:scale-105 hover:text-purple-300"
					onclick={handleBack}
				>
					← Back to Tools
				</button>
				<div class="flex items-center gap-2">
					<h1
						class="bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-3xl font-bold text-transparent"
					>
						MIDI to DTX Converter
					</h1>
					<div class="music-bars ml-2 flex items-end gap-1">
						<div class="music-bar h-2 w-1 rounded-full bg-purple-400"></div>
						<div class="music-bar h-3 w-1 rounded-full bg-purple-400"></div>
						<div class="music-bar h-4 w-1 rounded-full bg-purple-400"></div>
						<div class="music-bar h-2 w-1 rounded-full bg-purple-400"></div>
					</div>
				</div>
			</div>
			<Popover
				open={languagePopoverOpen}
				onOpenChange={(details) => (languagePopoverOpen = details.open)}
				positioning={{ placement: 'top' }}
				triggerBase="music-dropdown-trigger px-4 py-2 text-slate-200 border border-purple-500/30 backdrop-blur-sm bg-purple-900/20 hover:bg-purple-800/30 transition-all duration-300"
				contentBase="music-dropdown-content card space-y-4 max-w-[320px] border border-purple-500/30 backdrop-blur-lg bg-slate-900/95"
				arrow
				arrowBackground="!bg-slate-900"
			>
				{#snippet trigger()}
					Change Language
				{/snippet}
				{#snippet content()}
					<div class="mt-1 rounded-sm border border-purple-500/30 bg-slate-900 shadow-lg">
						{#each $locales as l}
							<button
								class="w-full p-2 text-left text-slate-300 transition-all duration-200 hover:bg-purple-800/30 hover:text-purple-300"
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

	<main class="relative z-10 container mx-auto max-w-4xl px-4 py-8">
		<div
			class="music-card rounded-lg border border-purple-500/30 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-lg"
		>
			<h2 class="mb-6 text-2xl font-bold text-slate-200">Convert MIDI to DTX</h2>

			<div class="space-y-6">
				<!-- Upload Section -->
				<div
					class="rounded-lg border-2 border-dashed border-purple-500/40 bg-slate-800/50 p-8 text-center backdrop-blur-sm"
				>
					{#if !uploadedFile}
						<div class="space-y-4">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-purple-500/30 bg-purple-900/50"
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
								<h3 class="text-lg font-medium text-slate-200">Upload MIDI File</h3>
								<p class="text-slate-400">Select a .mid or .midi file to convert</p>
							</div>
							<button
								type="button"
								class="music-btn-primary px-6 py-3 font-medium transition-all duration-300"
								onclick={handleUploadClick}
							>
								Choose File
							</button>
						</div>
					{:else}
						<div class="space-y-4">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-green-500/30 bg-green-900/50"
							>
								<svg
									class="h-6 w-6 text-green-400"
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
									class="music-btn-secondary border-red-500/50 px-4 py-2 font-medium text-red-300 transition-all duration-300 hover:bg-red-900/30 hover:text-red-200"
									onclick={handleReset}
								>
									Remove
								</button>
								<button
									type="button"
									class="music-btn-secondary px-4 py-2 font-medium transition-all duration-300"
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
						accept=".mid,.midi"
						onchange={handleFileUpload}
						class="hidden"
					/>
				</div>

				<!-- DTX Metadata Section -->
				{#if uploadedFile}
					<div
						class="music-card rounded-lg border border-purple-500/30 bg-slate-800/50 p-6 backdrop-blur-sm"
					>
						<h3 class="mb-4 text-lg font-semibold text-slate-200">DTX File Settings</h3>

						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<label for="title" class="block text-sm font-medium text-slate-300"
									>Title</label
								>
								<input
									id="title"
									type="text"
									bind:value={title}
									class="mt-1 w-full rounded border border-purple-500/30 bg-slate-900/50 px-3 py-2 text-slate-200 transition-all duration-300 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20"
								/>
							</div>
							<div>
								<label for="artist" class="block text-sm font-medium text-slate-300"
									>Artist</label
								>
								<input
									id="artist"
									type="text"
									bind:value={artist}
									class="mt-1 w-full rounded border border-purple-500/30 bg-slate-900/50 px-3 py-2 text-slate-200 transition-all duration-300 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20"
								/>
							</div>
							<div>
								<label for="level" class="block text-sm font-medium text-slate-300"
									>Difficulty Level</label
								>
								<input
									id="level"
									type="number"
									min="1"
									max="10"
									bind:value={level}
									class="mt-1 w-full rounded border border-purple-500/30 bg-slate-900/50 px-3 py-2 text-slate-200 transition-all duration-300 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20"
								/>
							</div>
							<div>
								<label for="bpm" class="block text-sm font-medium text-slate-300"
									>BPM</label
								>
								<input
									id="bpm"
									type="number"
									min="60"
									max="300"
									bind:value={bpm}
									class="mt-1 w-full rounded border border-purple-500/30 bg-slate-900/50 px-3 py-2 text-slate-200 transition-all duration-300 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20"
								/>
							</div>
						</div>

						<div class="mt-4">
							<label for="comment" class="block text-sm font-medium text-slate-300"
								>Comment</label
							>
							<input
								id="comment"
								type="text"
								bind:value={comment}
								class="mt-1 w-full rounded border border-purple-500/30 bg-slate-900/50 px-3 py-2 text-slate-200 transition-all duration-300 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20"
							/>
						</div>
					</div>

					<!-- MIDI Note Mapping Section -->
					<div
						class="music-card rounded-lg border border-purple-500/30 bg-slate-800/50 p-6 backdrop-blur-sm"
					>
						<h3 class="mb-4 text-lg font-semibold text-slate-200">
							MIDI Note to DTX Lane Mapping
						</h3>
						<p class="mb-4 text-sm text-slate-400">
							Configure which DTX lane each MIDI drum note should map to:
						</p>

						<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
							{#each Object.entries(midiToDtxMap) as [midiNote]}
								<div class="flex items-center space-x-3">
									<span class="min-w-[120px] text-sm font-medium text-slate-300">
										{getDrumName(Number(midiNote))} ({midiNote}):
									</span>
									<select
										value={midiToDtxMap[Number(midiNote)]}
										onchange={(e) => {
											midiToDtxMap[Number(midiNote)] = (
												e.target as HTMLSelectElement
											).value;
										}}
										class="rounded border border-purple-500/30 bg-slate-900/50 px-2 py-1 text-sm text-slate-200 transition-all duration-300 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20"
									>
										{#each availableLanes as lane}
											<option value={lane} class="bg-slate-900 text-slate-200"
												>{lane} - {getLaneName(lane)}</option
											>
										{/each}
									</select>
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
							class="music-btn-primary flex items-center gap-2 px-8 py-3 font-medium transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50"
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
								Convert to DTX
							{/if}
						</button>
					</div>
				{/if}

				<!-- Download Section -->
				{#if isConverted}
					<div
						class="music-card rounded-lg border-2 border-green-500/50 bg-green-900/20 p-6 backdrop-blur-sm"
					>
						<div class="space-y-4 text-center">
							<div
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-green-500/30 bg-green-900/50"
							>
								<svg
									class="h-6 w-6 text-green-400"
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
								<h3 class="text-lg font-medium text-green-300">
									Conversion Complete!
								</h3>
								<p class="text-green-200">Your DTX file is ready for download</p>
								<p class="text-sm text-green-300">{convertedFileName}</p>
								{#if convertedNotes}
									<p class="text-xs text-green-400">
										Converted {Object.values(convertedNotes).reduce(
											(total, measure) => total + measure.length,
											0
										)} note events
									</p>
								{/if}
							</div>
							<div class="flex justify-center gap-3">
								<button
									type="button"
									class="music-btn-primary border-green-500/50 bg-green-600 px-6 py-3 font-medium transition-all duration-300 hover:bg-green-500"
									onclick={handleDownload}
								>
									Download DTX File
								</button>
								<button
									type="button"
									class="music-btn-secondary px-4 py-2 font-medium transition-all duration-300"
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
		<div
			class="music-card mt-8 rounded-lg border border-purple-500/30 bg-slate-900/80 p-6 shadow-2xl backdrop-blur-lg"
		>
			<h3 class="mb-3 text-lg font-semibold text-slate-200">About MIDI to DTX Conversion</h3>
			<div class="space-y-2 text-slate-300">
				<p>
					This tool converts MIDI files to DTX drum chart format for use in rhythm games.
				</p>
				<p>
					<strong class="text-purple-300">Supported input:</strong> .mid and .midi files
				</p>
				<p>
					<strong class="text-purple-300">Output:</strong> .dtx files compatible with DTX-based
					rhythm games
				</p>
				<p>
					<strong class="text-purple-300">Features:</strong> Customizable metadata, configurable
					MIDI note-to-lane mapping, and proper timing conversion from MIDI ticks to DTX measures.
				</p>
				<p>
					<strong class="text-purple-300">Note:</strong> Only drum channel MIDI notes (typically
					channel 9) are processed. The converter focuses on standard General MIDI drum mappings.
				</p>
			</div>
		</div>
	</main>
</div>
