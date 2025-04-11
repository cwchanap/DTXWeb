<script lang="ts">
	import type { SoundChip } from '$lib/chart/dtx';
	import { FileButton } from '@skeletonlabs/skeleton';
	import store from '$lib/store';
	import type { SimFile } from '$lib/chart/simFile';
	import { XAaudioContext } from '$lib/browser/audioDecoder';

	let soundChips: SoundChip[] = $state([]);
	let simfile: SimFile | null = null;

	store.currentSoundChip.subscribe((value) => (soundChips = value));
	store.currentSimfile.subscribe((value) => (simfile = value));

	async function playAudio(file: string) {
		const soundFile = simfile?.files.find((f) => f.name.toLowerCase() === file.toLowerCase());
		if (soundFile) {
			if (soundFile.name.toLowerCase().endsWith('.xa')) {
				const source = XAaudioContext.createBufferSource();
				source.buffer = await XAaudioContext.decodeAudioData(await soundFile.arrayBuffer());
				source.connect(XAaudioContext.destination);
				source.start();
			} else {
				const audio = new Audio(URL.createObjectURL(soundFile));
				audio.play();
			}
		}
	}
</script>

<div class="flex flex-col space-y-2">
	<button
		class="w-1/2 rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
		onclick={() => {
			store.currentSoundChip.set([
				...soundChips,
				{ label: '', id: soundChips.length, volume: 100, position: 0, file: undefined }
			]);
		}}>New Sound</button
	>

	<div class="overflow-auto" style="max-height: 80vh;">
		<table class="w-full border-collapse">
			<thead class="bg-white">
				<tr><td class="w-[15%] border border-gray-300 text-center">Label</td></tr>
				<tr><td class="w-[10%] border border-gray-300 text-center">ID</td></tr>
				<tr><td class="w-[15%] border border-gray-300 text-center">Volume</td></tr>
				<tr><td class="w-[15%] border border-gray-300 text-center">Position</td></tr>
				<tr><td class="w-[45%] border border-gray-300 text-center">File</td></tr>
			</thead>
			<tbody>
				{#each soundChips as chip}
					<tr class="bg-white">
						<td class="border border-gray-300 px-2 py-1">
							<input type="text" bind:value={chip.label} class="w-full text-center" />
						</td>
						<td class="border border-gray-300 px-2 py-1 text-center">
							<span>{chip.id.toString(36).toUpperCase().padStart(2, '0')}</span>
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
											playAudio(chip.file);
										}
									}}
								>
									{chip.file}
								</button>
							{:else}
								<FileButton
									on:change={(e) => {
										chip.file = e.target.files?.[0];
									}}
									name="file"
									button="btn-sm variant-soft-primary"
									accept="audio/*"
									style="display: none;"
								/>
							{/if}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
