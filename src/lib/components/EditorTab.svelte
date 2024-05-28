<script lang="ts">
	import { EventBus } from '@/game/EventBus';
	import EventType from '@/game/EventType';

	let measureCount = 9;
	let bpm = 120;
	let title = '';
	let author = '';
	let comment = '';

	function handleMeasureChange() {
		EventBus.emit(EventType.MEASURE_UPDATE, measureCount);
	}
</script>

<div class="flex flex-col space-y-2">
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Title:</label>
		<input class="w-2/3" type="text" bind:value={title} />
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Author:</label>
		<input class="w-2/3" type="text" bind:value={author} />
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Comment:</label>
		<input class="w-2/3" type="text" bind:value={comment} />
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Number of Measures:</label>
		<input
			type="number"
			min="0"
			max="499"
			bind:value={measureCount}
			on:change={handleMeasureChange}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">BPM:</label>
		<input type="text" bind:value={bpm} />
	</div>
</div>
