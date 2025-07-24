<script lang="ts">
	import { SoundChip } from '../../chart/dtx';

	interface Props {
		soundChips?: SoundChip[];
		activeNote?: string;
		keyBindings?: Record<string, string>;
		isRemoteChart?: boolean;
		simfileID?: string;
		onSoundChipsChange?: (chips: SoundChip[]) => void;
		onActiveNoteChange?: (noteId: string) => void;
		onKeyBindingsChange?: (bindings: Record<string, string>) => void;
		onPlayAudio?: (file: string | File, volume: number, chip?: SoundChip) => Promise<void>;
		onShowToast?: (message: string, type: 'warning' | 'error') => void;
	}

	let {
		soundChips = $bindable([]),
		activeNote = $bindable('01'),
		keyBindings = $bindable({}),
		isRemoteChart = false,
		simfileID,
		onSoundChipsChange,
		onActiveNoteChange,
		onKeyBindingsChange,
		onPlayAudio,
		onShowToast
	}: Props = $props();

	function selectActiveNote(noteId: string) {
		activeNote = noteId;
		onActiveNoteChange?.(noteId);
	}

	function setKeyBinding(noteId: string, key: string) {
		if (key) {
			keyBindings[noteId] = key.toLowerCase();
		} else {
			delete keyBindings[noteId];
		}
		onKeyBindingsChange?.(keyBindings);
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
			onShowToast?.(
				`Key "${key}" is reserved for editor controls and cannot be bound`,
				'error'
			);
			return;
		}

		// Check if key is already bound to another note
		const existingNoteId = Object.keys(keyBindings).find((id) => keyBindings[id] === key);
		if (existingNoteId && existingNoteId !== noteId) {
			onShowToast?.(`Key "${key}" is already bound to note ${existingNoteId}`, 'warning');
			return;
		}

		setKeyBinding(noteId, key);
	}

	function handleNewSound() {
		// Generate next available ID (find the highest ID and add 1)
		const nextId =
			soundChips.length > 0 ? Math.max(...soundChips.map((chip) => chip.id)) + 1 : 1;
		const newChips = [...soundChips, new SoundChip('', nextId, 100, 0, '')];
		soundChips = newChips;
		onSoundChipsChange?.(newChips);
	}

	function updateSoundChip(chipId: number, updates: Partial<SoundChip>) {
		const updatedChips = soundChips.map((c) =>
			c.id === chipId ? Object.assign(Object.create(Object.getPrototypeOf(c)), c, updates) : c
		);
		soundChips = updatedChips;
		onSoundChipsChange?.(updatedChips);
	}

	function removeSoundChipFile(chipId: number) {
		const updatedChips = soundChips.map((c) =>
			c.id === chipId ? new SoundChip(c.label, c.id, c.volume, c.position, c.fileName) : c
		);
		soundChips = updatedChips;
		onSoundChipsChange?.(updatedChips);
	}

	function assignFileToChip(chipId: number, file: File) {
		const updatedChips = soundChips.map((c) =>
			c.id === chipId
				? new SoundChip(c.label, c.id, c.volume, c.position, c.fileName, file)
				: c
		);
		soundChips = updatedChips;
		onSoundChipsChange?.(updatedChips);
	}
</script>

<div class="flex flex-col space-y-2">
	{#if !isRemoteChart}
		<!-- Only show "New Sound" button for local charts -->
		<button
			class="w-1/5 rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
			onclick={handleNewSound}
		>
			New Sound
		</button>
	{:else}
		<!-- Show info text for remote charts -->
		<div class="w-full rounded-sm bg-gray-100 px-4 py-2 text-center text-sm text-gray-600">
			Sound files are managed remotely for this chart
		</div>
	{/if}

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
							<input
								type="text"
								value={chip.label}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									updateSoundChip(chip.id, { label: target.value });
								}}
								class="w-full text-center"
							/>
						</td>
						<td class="border border-gray-300 px-2 py-1 text-center">
							<span class="font-mono text-sm">{chipId}</span>
						</td>
						<td class="border border-gray-300 px-2 py-1">
							<input
								type="number"
								value={chip.volume}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									updateSoundChip(chip.id, { volume: parseInt(target.value) });
								}}
								min="0"
								max="100"
								class="w-full text-center"
							/>
						</td>
						<td class="border border-gray-300 px-2 py-1">
							<input
								type="number"
								value={chip.position}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									updateSoundChip(chip.id, { position: parseInt(target.value) });
								}}
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
							{#if isRemoteChart}
								<!-- For remote charts, show files based on fileName -->
								{#if chip.fileName}
									<button
										onclick={() => {
											onPlayAudio?.(chip.fileName, chip.volume, chip);
										}}
										class="flex-1 text-left text-blue-600 underline hover:text-blue-800"
									>
										{chip.fileName}
									</button>
								{:else}
									<span class="text-sm text-gray-500 italic"
										>No file assigned</span
									>
								{/if}
							{:else if chip.file}
								<!-- For local charts with files -->
								<div class="flex items-center space-x-2">
									<button
										onclick={() => {
											if (chip.file) {
												onPlayAudio?.(chip.file, chip.volume);
											}
										}}
										class="flex-1 text-left text-blue-600 underline hover:text-blue-800"
									>
										{typeof chip.file === 'string' ? chip.file : chip.file.name}
									</button>
									<button
										onclick={() => removeSoundChipFile(chip.id)}
										class="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 hover:text-red-800"
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
											assignFileToChip(chip.id, target.files[0]);
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
