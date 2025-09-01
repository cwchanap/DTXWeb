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

			// Override metadata with user settings
			dtxFile.title = title;
			dtxFile.artist = artist;
			dtxFile.level = level;
			dtxFile.comment = comment;

			// Parse MIDI file again to get the raw data for note conversion
			const arrayBuffer = await uploadedFile.arrayBuffer();
			const data = new Uint8Array(arrayBuffer);
			const midiData = (dtxFile as any).parseMidiFile(data);

			// Override BPM if detected from MIDI
			if (dtxFile.bpm && dtxFile.bpm !== 120) {
				bpm = dtxFile.bpm;
			} else {
				dtxFile.bpm = bpm;
			}

			// Convert MIDI notes to DTX format
			convertedNotes = dtxFile.convertMidiNotesToDtx(midiData);

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
				<h1 class="text-3xl font-bold text-white">MIDI to DTX Converter</h1>
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
			<h2 class="mb-6 text-2xl font-bold text-gray-900">Convert MIDI to DTX</h2>

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
								<h3 class="text-lg font-medium text-gray-900">Upload MIDI File</h3>
								<p class="text-gray-600">Select a .mid or .midi file to convert</p>
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
						accept=".mid,.midi"
						onchange={handleFileUpload}
						class="hidden"
					/>
				</div>

				<!-- DTX Metadata Section -->
				{#if uploadedFile}
					<div class="rounded-lg border border-gray-300 bg-gray-50 p-6">
						<h3 class="mb-4 text-lg font-semibold text-gray-900">DTX File Settings</h3>

						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<label for="title" class="block text-sm font-medium text-gray-700"
									>Title</label
								>
								<input
									id="title"
									type="text"
									bind:value={title}
									class="mt-1 w-full rounded border border-gray-300 px-3 py-2"
								/>
							</div>
							<div>
								<label for="artist" class="block text-sm font-medium text-gray-700"
									>Artist</label
								>
								<input
									id="artist"
									type="text"
									bind:value={artist}
									class="mt-1 w-full rounded border border-gray-300 px-3 py-2"
								/>
							</div>
							<div>
								<label for="level" class="block text-sm font-medium text-gray-700"
									>Difficulty Level</label
								>
								<input
									id="level"
									type="number"
									min="1"
									max="10"
									bind:value={level}
									class="mt-1 w-full rounded border border-gray-300 px-3 py-2"
								/>
							</div>
							<div>
								<label for="bpm" class="block text-sm font-medium text-gray-700"
									>BPM</label
								>
								<input
									id="bpm"
									type="number"
									min="60"
									max="300"
									bind:value={bpm}
									class="mt-1 w-full rounded border border-gray-300 px-3 py-2"
								/>
							</div>
						</div>

						<div class="mt-4">
							<label for="comment" class="block text-sm font-medium text-gray-700"
								>Comment</label
							>
							<input
								id="comment"
								type="text"
								bind:value={comment}
								class="mt-1 w-full rounded border border-gray-300 px-3 py-2"
							/>
						</div>
					</div>

					<!-- MIDI Note Mapping Section -->
					<div class="rounded-lg border border-gray-300 bg-gray-50 p-6">
						<h3 class="mb-4 text-lg font-semibold text-gray-900">
							MIDI Note to DTX Lane Mapping
						</h3>
						<p class="mb-4 text-sm text-gray-600">
							Configure which DTX lane each MIDI drum note should map to:
						</p>

						<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
							{#each Object.entries(midiToDtxMap) as [midiNote, dtxLane]}
								<div class="flex items-center space-x-3">
									<span class="min-w-[120px] text-sm font-medium text-gray-700">
										{getDrumName(Number(midiNote))} ({midiNote}):
									</span>
									<select
										bind:value={midiToDtxMap[Number(midiNote)]}
										class="rounded border border-gray-300 px-2 py-1 text-sm"
									>
										{#each Object.keys(midiToDtxMap).map((k) => midiToDtxMap[Number(k)]) as lane}
											<option value={lane}
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
								Convert to DTX
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
								<p class="text-green-700">Your DTX file is ready for download</p>
								<p class="text-sm text-green-600">{convertedFileName}</p>
								{#if convertedNotes}
									<p class="text-xs text-green-600">
										Converted {Object.values(convertedNotes).flat().length} note
										events
									</p>
								{/if}
							</div>
							<div class="flex justify-center gap-3">
								<button
									type="button"
									class="rounded-md bg-green-600 px-6 py-3 font-medium text-white transition-colors hover:bg-green-700"
									onclick={handleDownload}
								>
									Download DTX File
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
			<h3 class="mb-3 text-lg font-semibold text-gray-900">About MIDI to DTX Conversion</h3>
			<div class="space-y-2 text-gray-700">
				<p>
					This tool converts MIDI files to DTX drum chart format for use in rhythm games.
				</p>
				<p><strong>Supported input:</strong> .mid and .midi files</p>
				<p><strong>Output:</strong> .dtx files compatible with DTX-based rhythm games</p>
				<p>
					<strong>Features:</strong> Customizable metadata, configurable MIDI note-to-lane
					mapping, and proper timing conversion from MIDI ticks to DTX measures.
				</p>
				<p>
					<strong>Note:</strong> Only drum channel MIDI notes (typically channel 9) are processed.
					The converter focuses on standard General MIDI drum mappings.
				</p>
			</div>
		</div>
	</main>
</div>
