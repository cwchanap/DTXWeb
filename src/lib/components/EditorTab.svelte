<script lang="ts">
	import { EventBus } from '@/game/EventBus';
	import EventType from '@/game/EventType';
	import { DTXFile } from '@/lib/chart/dtx';

	export let dtxFile: DTXFile | null = null;
	let measureCount = 9;
	$: title = dtxFile ? dtxFile.title : '';
	$: artist = dtxFile ? dtxFile.artist : '';
	$: comment = dtxFile ? dtxFile.comment : '';
	$: bpm = dtxFile ? dtxFile.bpm : 120;

	function handleMeasureChange() {
		EventBus.emit(EventType.MEASURE_UPDATE, measureCount);
	}
</script>

<div class="flex flex-col space-y-2">
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Title:</label>
		<input class="w-2/3 rounded-md border border-gray-300 py-1" type="text" bind:value={title} />
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Artist:</label>
		<input class="w-2/3 rounded-md border border-gray-300 py-1" type="text" bind:value={artist} />
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Comment:</label>
		<input class="w-2/3 rounded-md border border-gray-300 py-1" type="text" bind:value={comment} />
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Number of Measures:</label>
		<input
			type="number"
			class="rounded-md border border-gray-300 py-1"
			min="0"
			max="499"
			bind:value={measureCount}
			on:change={handleMeasureChange}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">BPM:</label>
		<input class="rounded-md border border-gray-300 py-1" type="number" bind:value={bpm} />
	</div>
	
</div>
