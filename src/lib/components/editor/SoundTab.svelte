<script lang="ts">
	interface SoundChip {
		id: number;
		volume: number;
		file: string;
	}

	let chips: SoundChip[] = [];
</script>

<div class="flex flex-col space-y-2">
	<button
		class="w-1/2 rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
		on:click={() => {
			chips = [...chips, { id: chips.length, volume: 1, file: '' }];
		}}>New Sound</button
	>

	<table class="w-full border-collapse">
		<tr class="bg-white">
			<th class="w-1/4 border border-gray-300">ID</th>
			<th class="w-1/4 border border-gray-300">Volume</th>
			<th class="w-1/2 border border-gray-300">File</th>
		</tr>
		{#each chips as chip}
			<tr class="bg-white">
				<td class="border border-gray-300 px-2 py-1">{chip.id}</td>
				<td class="border border-gray-300 px-2 py-1">{chip.volume}</td>
				<td class="border border-gray-300 px-2 py-1">{chip.file}</td>
			</tr>
		{/each}
	</table>
</div>
