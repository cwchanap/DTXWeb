<script lang="ts">
	import { goto } from '$app/navigation';
	import { locale, locales } from 'svelte-i18n';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import toastStore from '$lib/toaster';

	const localeMap: Record<string, string> = {
		en: 'English',
		jp: '日本語'
	};

	let languagePopoverOpen = $state(false);
	let uploadedFile = $state<File | null>(null);
	let isLoading = $state(false);
	let midiData = $state<MidiFileData | null>(null);
	let isPlaying = $state(false);

	interface MidiTrack {
		name?: string;
		events: MidiEvent[];
		notes: MidiNote[];
		instruments: Set<number>;
		channels: Set<number>;
	}

	interface MidiNote {
		channel: number;
		note: number;
		velocity: number;
		startTime: number;
		duration: number;
		instrument?: number;
	}

	interface MidiEvent {
		deltaTime: number;
		type: 'meta' | 'channel';
		subtype?: number;
		data?: number[];
		channel?: number;
		command?: number;
		note?: number;
		velocity?: number;
		absoluteTime: number;
	}

	interface MidiFileData {
		format: number;
		tracks: MidiTrack[];
		ticksPerQuarter: number;
		tempo: number;
		duration: number;
		totalNotes: number;
		trackCount: number;
	}

	let fileInput: HTMLInputElement;

	const handleFileUpload = (event: Event) => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];

		if (file && file.name.toLowerCase().endsWith('.mid')) {
			uploadedFile = file;
			parseMidiFile(file);
		} else if (file) {
			toastStore.error({
				title: 'Invalid file type',
				description: 'Please select a valid MIDI file (.mid)',
				duration: 3000
			});
			target.value = '';
		}
	};

	const parseMidiFile = async (file: File) => {
		isLoading = true;
		try {
			const arrayBuffer = await file.arrayBuffer();
			const data = parseMidi(new Uint8Array(arrayBuffer));
			midiData = data;

			toastStore.success({
				title: 'MIDI file loaded',
				description: `Found ${data.trackCount} tracks with ${data.totalNotes} notes`,
				duration: 3000
			});
		} catch (error) {
			console.error('Error parsing MIDI file:', error);
			toastStore.error({
				title: 'Failed to parse MIDI',
				description: `Could not parse MIDI file: ${error instanceof Error ? error.message : 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			isLoading = false;
		}
	};

	const parseMidi = (data: Uint8Array): MidiFileData => {
		let offset = 0;

		// Read header
		const headerChunkType = String.fromCharCode(...data.slice(0, 4));
		if (headerChunkType !== 'MThd') {
			throw new Error('Invalid MIDI file - missing header');
		}

		const headerLength = readUint32(data, 4);
		const format = readUint16(data, 8);
		const trackCount = readUint16(data, 10);
		const ticksPerQuarter = readUint16(data, 12);

		offset = 8 + headerLength;

		const tracks: MidiTrack[] = [];
		let globalTempo = 120;

		for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
			const track = parseTrack(data, offset);
			tracks.push(track.track);
			offset = track.newOffset;

			// Look for tempo changes in this track
			for (const event of track.track.events) {
				if (event.type === 'meta' && event.subtype === 0x51 && event.data) {
					const microsecondsPerQuarter =
						(event.data[0] << 16) | (event.data[1] << 8) | event.data[2];
					globalTempo = Math.round(60000000 / microsecondsPerQuarter);
				}
			}
		}

		// Calculate total duration and notes
		let maxTime = 0;
		let totalNotes = 0;

		tracks.forEach((track) => {
			totalNotes += track.notes.length;
			track.notes.forEach((note) => {
				maxTime = Math.max(maxTime, note.startTime + note.duration);
			});
		});

		const duration = (maxTime / ticksPerQuarter) * (60 / globalTempo);

		return {
			format,
			tracks,
			ticksPerQuarter,
			tempo: globalTempo,
			duration,
			totalNotes,
			trackCount
		};
	};

	const parseTrack = (
		data: Uint8Array,
		startOffset: number
	): { track: MidiTrack; newOffset: number } => {
		let offset = startOffset;

		const trackChunkType = String.fromCharCode(...data.slice(offset, offset + 4));
		if (trackChunkType !== 'MTrk') {
			throw new Error('Invalid track header');
		}

		const trackLength = readUint32(data, offset + 4);
		offset += 8;
		const trackEnd = offset + trackLength;

		const events: MidiEvent[] = [];
		const notes: MidiNote[] = [];
		const instruments = new Set<number>();
		const channels = new Set<number>();
		let trackName: string | undefined;

		let currentTime = 0;
		let runningStatus = 0;
		const activeNotes = new Map<
			string,
			{ note: number; velocity: number; startTime: number; channel: number }
		>();

		while (offset < trackEnd) {
			const deltaTime = readVariableLength(data, offset);
			offset += deltaTime.bytes;
			currentTime += deltaTime.value;

			let eventType = data[offset];

			// Handle running status
			if (eventType < 0x80) {
				eventType = runningStatus;
				offset--;
			} else {
				runningStatus = eventType;
			}

			offset++;

			const event: MidiEvent = {
				deltaTime: deltaTime.value,
				absoluteTime: currentTime,
				type: eventType >= 0xf0 ? 'meta' : 'channel'
			};

			if (eventType === 0xff) {
				// Meta event
				const metaType = data[offset++];
				const length = readVariableLength(data, offset);
				offset += length.bytes;

				event.type = 'meta';
				event.subtype = metaType;
				event.data = Array.from(data.slice(offset, offset + length.value));

				// Track name
				if (metaType === 0x03 && !trackName) {
					trackName = String.fromCharCode(...event.data);
				}

				offset += length.value;
			} else if (eventType >= 0x80 && eventType < 0xf0) {
				// Channel event
				const command = eventType & 0xf0;
				const channel = eventType & 0x0f;

				event.type = 'channel';
				event.command = command;
				event.channel = channel;

				channels.add(channel);

				if (command === 0x90 || command === 0x80) {
					// Note on/off
					const note = data[offset++];
					const velocity = data[offset++];

					event.note = note;
					event.velocity = velocity;

					const noteKey = `${channel}-${note}`;

					if (command === 0x90 && velocity > 0) {
						// Note on
						activeNotes.set(noteKey, {
							note,
							velocity,
							startTime: currentTime,
							channel
						});
					} else {
						// Note off
						const activeNote = activeNotes.get(noteKey);
						if (activeNote) {
							notes.push({
								channel: activeNote.channel,
								note: activeNote.note,
								velocity: activeNote.velocity,
								startTime: activeNote.startTime,
								duration: currentTime - activeNote.startTime
							});
							activeNotes.delete(noteKey);
						}
					}
				} else if (command === 0xc0) {
					// Program change
					const instrument = data[offset++];
					instruments.add(instrument);
				} else {
					// Other channel events
					const paramCount = getChannelEventParamCount(command);
					for (let i = 0; i < paramCount; i++) {
						offset++;
					}
				}
			}

			events.push(event);
		}

		// Handle any remaining active notes
		activeNotes.forEach((activeNote, noteKey) => {
			notes.push({
				channel: activeNote.channel,
				note: activeNote.note,
				velocity: activeNote.velocity,
				startTime: activeNote.startTime,
				duration: currentTime - activeNote.startTime
			});
		});

		return {
			track: {
				name: trackName,
				events,
				notes,
				instruments,
				channels
			},
			newOffset: offset
		};
	};

	const readUint16 = (data: Uint8Array, offset: number): number => {
		return (data[offset] << 8) | data[offset + 1];
	};

	const readUint32 = (data: Uint8Array, offset: number): number => {
		return (
			(data[offset] << 24) |
			(data[offset + 1] << 16) |
			(data[offset + 2] << 8) |
			data[offset + 3]
		);
	};

	const readVariableLength = (
		data: Uint8Array,
		offset: number
	): { value: number; bytes: number } => {
		let value = 0;
		let bytes = 0;

		while (bytes < 4) {
			const byte = data[offset + bytes];
			value = (value << 7) | (byte & 0x7f);
			bytes++;

			if (!(byte & 0x80)) {
				break;
			}
		}

		return { value, bytes };
	};

	const getChannelEventParamCount = (command: number): number => {
		switch (command) {
			case 0x80:
			case 0x90:
			case 0xa0:
			case 0xb0:
			case 0xe0:
				return 2;
			case 0xc0:
			case 0xd0:
				return 1;
			default:
				return 0;
		}
	};

	const formatTime = (seconds: number): string => {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = Math.floor(seconds % 60);
		return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
	};

	const getNoteName = (noteNumber: number): string => {
		const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
		const octave = Math.floor(noteNumber / 12) - 1;
		return `${notes[noteNumber % 12]}${octave}`;
	};

	const getInstrumentName = (program: number): string => {
		// General MIDI instrument names (simplified)
		const instruments = [
			'Acoustic Grand Piano',
			'Bright Acoustic Piano',
			'Electric Grand Piano',
			'Honky-tonk Piano',
			'Electric Piano 1',
			'Electric Piano 2',
			'Harpsichord',
			'Clavi',
			'Celesta',
			'Glockenspiel',
			'Music Box',
			'Vibraphone',
			'Marimba',
			'Xylophone',
			'Tubular Bells',
			'Dulcimer'
			// ... truncated for brevity
		];
		return instruments[program] || `Program ${program}`;
	};

	const handleUploadClick = () => {
		fileInput?.click();
	};

	const handleReset = () => {
		uploadedFile = null;
		midiData = null;
		isPlaying = false;
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
				<h1 class="text-3xl font-bold text-white">MIDI Preview</h1>
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

	<main class="container mx-auto max-w-6xl px-4 py-8">
		<div class="space-y-8">
			<!-- Upload Section -->
			<div class="rounded-lg border border-gray-300 bg-white p-8 shadow-sm">
				<h2 class="mb-6 text-2xl font-bold text-gray-900">Upload MIDI File</h2>

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
										d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
									/>
								</svg>
							</div>
							<div>
								<h3 class="text-lg font-medium text-gray-900">Upload MIDI File</h3>
								<p class="text-gray-600">Select a .mid file to preview</p>
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
								<h3 class="text-lg font-medium text-gray-900">File Loaded</h3>
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

				{#if isLoading}
					<div class="mt-6 flex items-center justify-center">
						<div
							class="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600"
						></div>
						<span class="ml-3 text-gray-600">Parsing MIDI file...</span>
					</div>
				{/if}
			</div>

			<!-- MIDI File Information -->
			{#if midiData}
				<div class="rounded-lg border border-gray-300 bg-white p-8 shadow-sm">
					<h2 class="mb-6 text-2xl font-bold text-gray-900">File Information</h2>

					<div class="grid grid-cols-2 gap-6 md:grid-cols-4">
						<div class="text-center">
							<div class="text-2xl font-bold text-indigo-600">{midiData.format}</div>
							<div class="text-sm text-gray-600">Format</div>
						</div>
						<div class="text-center">
							<div class="text-2xl font-bold text-indigo-600">
								{midiData.trackCount}
							</div>
							<div class="text-sm text-gray-600">Tracks</div>
						</div>
						<div class="text-center">
							<div class="text-2xl font-bold text-indigo-600">
								{midiData.totalNotes}
							</div>
							<div class="text-sm text-gray-600">Total Notes</div>
						</div>
						<div class="text-center">
							<div class="text-2xl font-bold text-indigo-600">
								{formatTime(midiData.duration)}
							</div>
							<div class="text-sm text-gray-600">Duration</div>
						</div>
					</div>

					<div class="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<div class="text-sm font-medium text-gray-700">Tempo</div>
							<div class="text-lg text-gray-900">{midiData.tempo} BPM</div>
						</div>
						<div>
							<div class="text-sm font-medium text-gray-700">Ticks per Quarter</div>
							<div class="text-lg text-gray-900">{midiData.ticksPerQuarter}</div>
						</div>
					</div>
				</div>

				<!-- Track Details -->
				<div class="rounded-lg border border-gray-300 bg-white p-8 shadow-sm">
					<h2 class="mb-6 text-2xl font-bold text-gray-900">Track Details</h2>

					<div class="space-y-4">
						{#each midiData.tracks as track, index}
							<div class="rounded-lg border border-gray-200 p-4">
								<div class="mb-3 flex items-center justify-between">
									<h3 class="text-lg font-semibold">
										Track {index + 1}
										{#if track.name}
											- {track.name}
										{/if}
									</h3>
									<div class="text-sm text-gray-600">
										{track.notes.length} notes
									</div>
								</div>

								<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
									<div>
										<div class="text-sm font-medium text-gray-700">
											Channels
										</div>
										<div class="text-sm text-gray-900">
											{Array.from(track.channels)
												.sort((a, b) => a - b)
												.join(', ') || 'None'}
										</div>
									</div>
									<div>
										<div class="text-sm font-medium text-gray-700">
											Instruments
										</div>
										<div class="text-sm text-gray-900">
											{Array.from(track.instruments).length > 0
												? Array.from(track.instruments)
														.map((i) => getInstrumentName(i))
														.join(', ')
												: 'None specified'}
										</div>
									</div>
									<div>
										<div class="text-sm font-medium text-gray-700">
											Note Range
										</div>
										<div class="text-sm text-gray-900">
											{#if track.notes.length > 0}
												{@const minNote = Math.min(
													...track.notes.map((n) => n.note)
												)}
												{@const maxNote = Math.max(
													...track.notes.map((n) => n.note)
												)}
												{getNoteName(minNote)} - {getNoteName(maxNote)}
											{:else}
												No notes
											{/if}
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Info Section -->
		<div class="mt-8 rounded-lg border border-gray-300 bg-white p-6 shadow-sm">
			<h3 class="mb-3 text-lg font-semibold text-gray-900">About MIDI Preview</h3>
			<div class="space-y-2 text-gray-700">
				<p>
					This tool allows you to preview and analyze MIDI files, providing detailed
					information about tracks, instruments, and note data.
				</p>
				<p><strong>Supported formats:</strong> Standard MIDI files (.mid, .midi)</p>
				<p>
					<strong>Features:</strong> Track analysis, instrument detection, note counting, and
					timing information.
				</p>
			</div>
		</div>
	</main>
</div>
