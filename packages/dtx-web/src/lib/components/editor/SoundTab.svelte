<script lang="ts">
	import store from '$lib/store';
	import { SoundChip, type SimFile } from '@dtx/common';
	import { XAaudioContext } from '$lib/browser/audioDecoder';
	import { file } from 'jszip';

	let soundChips: SoundChip[] = $state([]);
	let simfile: SimFile | null = null;
	let activeNote: string = $state('01');
	let keyBindings: Record<string, string> = $state({}); // noteId -> key mapping

	store.currentSoundChip.subscribe((value) => (soundChips = value));
	store.currentSimfile.subscribe((value) => (simfile = value));
	store.activeNote.subscribe((value) => (activeNote = value));

	async function playAudio(file: string | File, volume: number = 100) {
		let soundFile: File | undefined;

		if (typeof file === 'string') {
			soundFile = simfile?.files.find((f) => f.name.toLowerCase() === file.toLowerCase());
		} else {
			soundFile = file;
		}

		if (soundFile) {
			const volumeLevel = volume / 100;

			if (soundFile.name.toLowerCase().endsWith('.xa')) {
				const source = XAaudioContext.createBufferSource();
				const gainNode = XAaudioContext.createGain();

				source.buffer = await XAaudioContext.decodeAudioData(await soundFile.arrayBuffer());
				gainNode.gain.value = volumeLevel;

				source.connect(gainNode);
				gainNode.connect(XAaudioContext.destination);
				source.start();
			} else {
				const audio = new Audio(URL.createObjectURL(soundFile));
				audio.volume = volumeLevel;
				audio.play();
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
			alert(`Key "${key}" is reserved for editor controls and cannot be bound`);
			return;
		}

		// Check if key is already bound to another note
		const existingNoteId = Object.keys(keyBindings).find((id) => keyBindings[id] === key);
		if (existingNoteId && existingNoteId !== noteId) {
			alert(`Key "${key}" is already bound to note ${existingNoteId}`);
			return;
		}

		setKeyBinding(noteId, key);
	}
</script>

<div class="flex flex-col space-y-2">
	<button
		class="w-1/5 rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
		onclick={() => {
			// Generate next available ID (find the highest ID and add 1)
			const nextId =
				soundChips.length > 0 ? Math.max(...soundChips.map((chip) => chip.id)) + 1 : 1;

			store.currentSoundChip.set([...soundChips, new SoundChip('', nextId, 100, 0, '')]);
		}}>New Sound</button
	>

	<div class="overflow-auto" style="max-height: 80vh;">
		<table class="w-full border-collapse">
			<thead class="bg-white">
				<tr>
					<td class="w-[10%] border border-gray-300 text-center">Active</td>
					<td class="w-[12%] border border-gray-300 text-center">Label</td>
					<td class="w-[8%] border border-gray-300 text-center">ID</td>
					<td class="w-[12%] border border-gray-300 text-center">Volume</td>
					<td class="w-[12%] border border-gray-300 text-center">Position</td>
					<td class="w-[12%] border border-gray-300 text-center">Key Binding</td>
					<td class="w-[34%] border border-gray-300 text-center">File</td>
				</tr>
			</thead>
			<tbody>
				{#each soundChips as chip (chip.id)}
					{@const chipId = chip.id.toString(36).toUpperCase().padStart(2, '0')}
					<tr class="bg-white {activeNote === chipId ? 'ring-2 ring-blue-500' : ''}">
						<td class="border border-gray-300 px-2 py-1 text-center">
							<button
								onclick={() => selectActiveNote(chipId)}
								class="rounded-full border-2 {activeNote === chipId
									? 'border-blue-500 bg-blue-500'
									: 'border-gray-300'} h-5 w-5 hover:border-blue-400"
								title="Set as active note"
							>
								{#if activeNote === chipId}
									<span class="block h-3 w-3 rounded-full bg-white"></span>
								{/if}
							</button>
						</td>
						<td class="border border-gray-300 px-2 py-1">
							<input type="text" bind:value={chip.label} class="w-full text-center" />
						</td>
						<td class="border border-gray-300 px-2 py-1 text-center">
							<span class="font-mono text-sm">{chipId}</span>
						</td>
						<td class="border border-gray-300 px-2 py-1">
							<input
								type="number"
								bind:value={chip.volume}
								min="0"
								max="100"
								class="w-full text-center"
							/>
						</td>
						<td class="border border-gray-300 px-2 py-1">
							<input
								type="number"
								bind:value={chip.position}
								class="w-full text-center"
							/>
						</td>
						<td class="border border-gray-300 px-2 py-1">
							<input
								type="text"
								value={keyBindings[chipId] || ''}
								onkeydown={(e) => handleKeyInput(e, chipId)}
								placeholder="Press key"
								class="w-full text-center text-sm"
								readonly
							/>
						</td>

						<td class="border border-gray-300 px-2 py-1">
							{#if chip.file}
								<div class="flex items-center space-x-2">
									<button
										onclick={() => {
											if (chip.file) {
												playAudio(chip.file, chip.volume);
											}
										}}
										class="flex-1 text-left text-blue-600 underline hover:text-blue-800"
									>
										{typeof chip.file === 'string' ? chip.file : chip.file.name}
									</button>
									<button
										onclick={() => {
											// Create a new array with updated chip (file removed)
											const updatedChips = soundChips.map((c) =>
												c.id === chip.id ? { ...c, file: undefined } : c
											);
											store.currentSoundChip.set(updatedChips);
										}}
										class="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 hover:text-red-800"
										title="Remove file"
									>
										✕
									</button>
								</div>
							{:else}
								<input
									type="file"
									accept="audio/*"
									onchange={(e) => {
										const target = e.target as HTMLInputElement;
										if (target.files?.[0]) {
											// Create a new array with updated chip
											const updatedChips = soundChips.map((c) =>
												c.id === chip.id
													? { ...c, file: target.files![0] }
													: c
											);
											store.currentSoundChip.set(updatedChips);
										}
									}}
									class="w-full text-sm file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-blue-500 file:px-3 file:py-1 file:text-sm file:text-white hover:file:bg-blue-600"
								/>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
