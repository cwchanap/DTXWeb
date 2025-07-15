<script lang="ts">
	import store from '$lib/store';
	import { SoundChip, type SimFile } from '@dtx/common';
	import { XAaudioContext } from '$lib/browser/audioDecoder';
	import { file } from 'jszip';

	let soundChips: SoundChip[] = $state([]);
	let simfile: SimFile | null = null;
	let activeNote: string = $state('01');

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
</script>

<div class="flex flex-col space-y-2">
	<button
		class="w-1/5 rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
		onclick={() => {
			store.currentSoundChip.set([
				...soundChips,
				new SoundChip('', SoundChip.length, 100, 0, file.name)
			]);
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
					<td class="w-[46%] border border-gray-300 text-center">File</td>
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

						<td class="border border-gray-300 px-2 py-1"
							>{#if chip.file}
								<button
									onclick={() => {
										if (chip.file) {
											playAudio(chip.file, chip.volume);
										}
									}}
									class="text-blue-600 underline hover:text-blue-800"
								>
									{typeof chip.file === 'string' ? chip.file : chip.file.name}
								</button>
							{:else}
								<input
									type="file"
									accept="audio/*"
									onchange={(e) => {
										const target = e.target as HTMLInputElement;
										if (target.files?.[0]) {
											chip.file = target.files[0];
										}
									}}
									class="w-full text-sm"
								/>
							{/if}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
