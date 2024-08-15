<script lang="ts">
	import { EventBus } from '@/game/EventBus';
	import EventType from '@/game/EventType';
	import { onMount } from 'svelte';
	import store from '@/lib/store';
	import { DTXFile } from '@/lib/chart/dtx';

	let dtxFile: DTXFile | null;
	let measureCount = 9;
	let title = '';
	let artist = '';
	let comment = '';
	let bpm = 0;
	let level = 0;

	$: {
		if (dtxFile) {
			dtxFile.title = title;
			dtxFile.artist = artist;
			dtxFile.comment = comment;
			dtxFile.bpm = bpm;
			dtxFile.level = level;
			store.currentDtxFile.set(dtxFile);
		}
	}

	function handleMeasureChange() {
		EventBus.emit(EventType.MEASURE_UPDATE, measureCount);
	}

	onMount(() => {
		return store.currentDtxFile.subscribe((value) => {
			dtxFile = value;
			title = dtxFile?.title ?? '';
			artist = dtxFile?.artist ?? '';
			comment = dtxFile?.comment ?? '';
			bpm = dtxFile?.bpm ?? 0;
			level = dtxFile?.level ?? 0;
		});
	});
</script>

<div class="flex flex-col space-y-2">
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Title:</label>
		<input
			class="w-2/3 rounded-md border border-gray-300 px-2 py-1"
			type="text"
			bind:value={title}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Artist:</label>
		<input
			class="w-2/3 rounded-md border border-gray-300 px-2 py-1"
			type="text"
			bind:value={artist}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Comment:</label>
		<input
			class="w-2/3 rounded-md border border-gray-300 px-2 py-1"
			type="text"
			bind:value={comment}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">BPM:</label>
		<input class="rounded-md border border-gray-300 px-2 py-1" type="number" bind:value={bpm} />
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Level:</label>
		<input
			class="rounded-md border border-gray-300 px-2 py-1"
			type="number"
			min="0"
			max="999"
			bind:value={level}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-1/3 text-gray-700" for="measure-input">Number of Measures:</label>
		<input
			type="number"
			class="rounded-md border border-gray-300 px-2 py-1"
			min="0"
			max="499"
			bind:value={measureCount}
			on:change={handleMeasureChange}
		/>
	</div>
</div>
