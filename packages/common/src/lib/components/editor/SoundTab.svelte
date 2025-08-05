<script lang="ts">
	import { store } from '@dtx/common';
	import { SoundChip, type SimFile } from '@dtx/common';
	import { XAaudioContext } from '../../browser/audioDecoder';
	// Note: PUBLIC_SIMFILE_BUCKET_URL is platform-specific - dtx-web and dtx-desktop will handle this differently
	import * as FileManager from '../../services/fileManager';

	interface Props {
		simfileID?: string;
		theme?: 'light' | 'dark';
	}

	let { simfileID, theme = 'dark' }: Props = $props();

	// Theme-based classes
	const themeClasses = {
		light: {
			infoBox: 'bg-gray-100 text-gray-700',
			tableHead: 'bg-gray-100',
			tableRow: 'bg-white',
			border: 'border-gray-300',
			text: 'text-gray-700',
			textMuted: 'text-gray-500',
			input: 'bg-white text-gray-700 border-gray-300',
			link: 'text-blue-600 hover:text-blue-800',
			removeButton: 'border-red-300 text-red-600 hover:bg-red-50 hover:text-red-800'
		},
		dark: {
			infoBox: 'bg-gray-800 text-gray-300',
			tableHead: 'bg-gray-800',
			tableRow: 'bg-gray-900',
			border: 'border-gray-600',
			text: 'text-gray-200',
			textMuted: 'text-gray-400',
			input: 'bg-gray-800 text-gray-200 border-gray-600',
			link: 'text-blue-600 hover:text-blue-800',
			removeButton: 'border-red-300 text-red-600 hover:bg-red-50 hover:text-red-800'
		}
	};

	const classes = themeClasses[theme];

	let soundChips: SoundChip[] = $state([]);
	let simfile: SimFile | null = null;
	let activeNote: string = $state('01');
	let keyBindings: Record<string, string> = $state({}); // noteId -> key mapping
	let showToast = $state(false);
	let toastMessage = $state('');
	let toastType: 'warning' | 'error' = $state('warning');

	store.currentSoundChip.subscribe((value) => {
		soundChips = value;
	});
	store.currentSimfile.subscribe((value) => (simfile = value));
	store.activeNote.subscribe((value) => (activeNote = value));

	function showToastMessage(message: string, type: 'warning' | 'error' = 'warning') {
		toastMessage = message;
		toastType = type;
		showToast = true;
		// Auto-hide toast after 4 seconds
		setTimeout(() => {
			showToast = false;
		}, 4000);
	}

	async function playAudio(file: string | File, volume: number = 100, chip?: SoundChip) {
		let soundFile: File | undefined;
		const volumeLevel = volume / 100;

		if (typeof file === 'string') {
			if (simfileID) {
				// Remote chart case
				if (chip?.file) {
					soundFile = chip.file;
				} else {
					// Remote file not yet fetched - cannot play audio
					console.warn('Remote file not yet fetched:', file);
					showToastMessage(
						`Sound file "${file}" is not yet loaded from remote`,
						'warning'
					);
					return;
				}
			} else {
				// Local chart case
				const fileKey = FileManager.generateKey(null, file);
				soundFile = FileManager.getFile(fileKey);
				if (!soundFile) {
					// Fallback: search in simfile.files (for backwards compatibility)
					soundFile = simfile?.files.find(
						(f) => f.name.toLowerCase() === file.toLowerCase()
					);
				}
			}
		} else {
			soundFile = file;
		}

		if (soundFile) {
			try {
				if (soundFile.name.toLowerCase().endsWith('.xa')) {
					const source = XAaudioContext.createBufferSource();
					const gainNode = XAaudioContext.createGain();

					source.buffer = await XAaudioContext.decodeAudioData(
						await soundFile.arrayBuffer()
					);
					gainNode.gain.value = volumeLevel;

					source.connect(gainNode);
					gainNode.connect(XAaudioContext.destination);
					source.start();
				} else {
					const audio = new Audio(URL.createObjectURL(soundFile));
					audio.volume = volumeLevel;
					await audio.play();
				}
			} catch (error) {
				console.error('Error playing audio:', error);
			}
		}
	}

	function selectActiveNote(noteId: string) {
		store.activeNote.set(noteId);
	}

	function setKeyBinding(noteId: string, key: string) {
		if (key) {
			keyBindings[noteId] = key.toLowerCase();
		} else {
			delete keyBindings[noteId];
		}
		// Update the store with key bindings
		store.keyBindings?.set(keyBindings);
	}

	function handleKeyInput(event: KeyboardEvent, noteId: string) {
		event.preventDefault();
		const key = event.key.toLowerCase();

		// Ignore modifier keys and special keys
		if (key.length > 1 && !['space', 'enter', 'backspace', 'delete'].includes(key)) {
			return;
		}

		// Clear binding if backspace or delete
		if (key === 'backspace' || key === 'delete') {
			setKeyBinding(noteId, '');
			return;
		}

		// Exclude reserved keys used by the editor
		const reservedKeys = ['q']; // Q is used for toggling editing mode
		if (reservedKeys.includes(key)) {
			showToastMessage(
				`Key "${key}" is reserved for editor controls and cannot be bound`,
				'error'
			);
			return;
		}

		// Check if key is already bound to another note
		const existingNoteId = Object.keys(keyBindings).find((id) => keyBindings[id] === key);
		if (existingNoteId && existingNoteId !== noteId) {
			showToastMessage(`Key "${key}" is already bound to note ${existingNoteId}`, 'warning');
			return;
		}

		setKeyBinding(noteId, key);
	}
</script>

<div class="flex flex-col space-y-2">
	{#if !simfileID}
		<!-- Only show "New Sound" button for local charts -->
		<button
			class="w-1/5 rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
			onclick={() => {
				// Generate next available ID (find the highest ID and add 1)
				const nextId =
					soundChips.length > 0 ? Math.max(...soundChips.map((chip) => chip.id)) + 1 : 1;

				store.currentSoundChip.set([...soundChips, new SoundChip('', nextId, 100, 0, '')]);
			}}>New Sound</button
		>
	{/if}

	<div class="overflow-auto" style="max-height: 80vh;">
		<table class="w-full border-collapse">
			<thead class={classes.tableHead}>
				<tr>
					<td class="w-[10%] border text-center {classes.border} {classes.text}"
						>Active</td
					>
					<td class="w-[12%] border text-center {classes.border} {classes.text}">Label</td
					>
					<td class="w-[8%] border text-center {classes.border} {classes.text}">ID</td>
					<td class="w-[12%] border text-center {classes.border} {classes.text}"
						>Volume</td
					>
					<td class="w-[12%] border text-center {classes.border} {classes.text}"
						>Position</td
					>
					<td class="w-[12%] border text-center {classes.border} {classes.text}"
						>Key Binding</td
					>
					<td class="w-[34%] border text-center {classes.border} {classes.text}">File</td>
				</tr>
			</thead>
			<tbody>
				{#each soundChips as chip (chip.id)}
					{@const chipId = chip.id.toString(36).toUpperCase().padStart(2, '0')}
					<tr
						class="{classes.tableRow} {activeNote === chipId
							? 'ring-2 ring-blue-500'
							: ''}"
					>
						<td class="border px-2 py-1 text-center {classes.border}">
							<button
								onclick={() => selectActiveNote(chipId)}
								class="rounded-full border-2 {activeNote === chipId
									? 'border-blue-500 bg-blue-500'
									: 'border-gray-500'} h-5 w-5 hover:border-blue-400"
								title="Set as active note"
							>
								{#if activeNote === chipId}
									<span class="block h-3 w-3 rounded-full bg-white"></span>
								{/if}
							</button>
						</td>
						<td class="border px-2 py-1 {classes.border}">
							<input
								type="text"
								value={chip.label}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									chip.label = target.value;
								}}
								class="w-full text-center {classes.input}"
							/>
						</td>
						<td class="border px-2 py-1 text-center {classes.border}">
							<span class="font-mono text-sm {classes.text}">{chipId}</span>
						</td>
						<td class="border px-2 py-1 {classes.border}">
							<input
								type="number"
								value={chip.volume}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									chip.volume = parseInt(target.value);
								}}
								min="0"
								max="100"
								class="w-full text-center {classes.input}"
							/>
						</td>
						<td class="border px-2 py-1 {classes.border}">
							<input
								type="number"
								value={chip.position}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									chip.position = parseInt(target.value);
								}}
								class="w-full text-center {classes.input}"
							/>
						</td>
						<td class="border px-2 py-1 {classes.border}">
							<input
								type="text"
								value={keyBindings[chipId] || ''}
								onkeydown={(e) => handleKeyInput(e, chipId)}
								placeholder="Press key"
								class="w-full text-center text-sm {classes.input}"
								readonly
							/>
						</td>

						<td class="border px-2 py-1 {classes.border}">
							{#if simfileID}
								<!-- For remote charts, show files based on fileName -->
								{#if chip.fileName}
									<button
										onclick={() => {
											playAudio(chip.fileName, chip.volume, chip);
										}}
										class="flex-1 text-left {classes.link} underline"
									>
										{chip.fileName}
									</button>
								{:else}
									<span class="text-sm italic {classes.textMuted}"
										>No file assigned</span
									>
								{/if}
							{:else if chip.file}
								<!-- For local charts with files -->
								<div class="flex items-center space-x-2">
									<button
										onclick={() => {
											if (chip.file) {
												playAudio(chip.file, chip.volume);
											}
										}}
										class="flex-1 text-left {classes.link} underline"
									>
										{typeof chip.file === 'string' ? chip.file : chip.file.name}
									</button>
									<button
										onclick={() => {
											// Create a new array with updated chip (file removed)
											const updatedChips = soundChips.map((c) =>
												c.id === chip.id
													? new SoundChip(
															c.label,
															c.id,
															c.volume,
															c.position,
															c.fileName
														)
													: c
											);
											store.currentSoundChip.set(updatedChips);
										}}
										class="rounded border px-2 py-1 text-xs {classes.removeButton}"
										title="Remove file"
									>
										✕
									</button>
								</div>
							{:else}
								<!-- For local charts without files, allow file upload -->
								<input
									type="file"
									accept="audio/*"
									onchange={(e) => {
										const target = e.target as HTMLInputElement;
										if (target.files?.[0]) {
											// Create a new array with updated chip
											const updatedChips = soundChips.map((c) =>
												c.id === chip.id
													? new SoundChip(
															c.label,
															c.id,
															c.volume,
															c.position,
															c.fileName,
															target.files![0]
														)
													: c
											);
											store.currentSoundChip.set(updatedChips);
										}
									}}
									class="w-full text-sm {classes.input} file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-blue-500 file:px-3 file:py-1 file:text-sm file:text-white hover:file:bg-blue-600"
								/>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
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
