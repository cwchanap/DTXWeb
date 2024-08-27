<script lang="ts">
	import type { SoundChip } from '@/lib/chart/dtx';
	import { FileButton } from '@skeletonlabs/skeleton';
	import store from '@/lib/store';
	import type { SimFile } from '@/lib/chart/simFile';

	let soundChips: SoundChip[] = [];
    let simfile: SimFile | null = null;

	store.currentSoundChip.subscribe((value) => (soundChips = value));
    store.currentSimfile.subscribe((value) => (simfile = value));

    function createAudio(file: string) {
        const soundFile = simfile?.files.find((f) => f.name === file);
        if (soundFile) {
            return new Audio(URL.createObjectURL(soundFile));
        }
    }
</script>

<div class="flex flex-col space-y-2">
	<button
		class="w-1/2 rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
		on:click={() => {
			store.currentSoundChip.set([
				...soundChips,
				{ label: '', id: soundChips.length, volume: 100, position: 0, file: undefined }
			]);
		}}>New Sound</button
	>

	<div class="overflow-auto" style="max-height: 80vh;">
		<table class="w-full border-collapse">
			<tr class="bg-white">
				<th class="w-[15%] border border-gray-300 text-center">Label</th>
				<th class="w-[10%] border border-gray-300 text-center">ID</th>
				<th class="w-[15%] border border-gray-300 text-center">Volume</th>
				<th class="w-[15%] border border-gray-300 text-center">Position</th>
				<th class="w-[45%] border border-gray-300 text-center">File</th>
			</tr>
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
								on:click={() => {
									if (chip.file) {
                                        const audio = createAudio(chip.file);
                                        audio?.play();
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
		</table>
	</div>
</div>
