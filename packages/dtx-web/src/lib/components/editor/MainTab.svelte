<script lang="ts">
	import { run } from 'svelte/legacy';

	import { EventBus } from '@/game/EventBus';
	import EventType from '@/game/EventType';
	import { onMount } from 'svelte';
	import store from '$lib/store';
	import { DTXFile } from '@dtx/common';
	import { Play, CirclePause } from '@lucide/svelte/icons';

	let dtxFile: DTXFile | null = $state(null);
	let measureCount = $state(10);
	let title = $state('');
	let artist = $state('');
	let comment = $state('');
	let bpm = $state(120);
	let level = $state(0);
	let gotoMeasure = $state(0);
	let isPreviewing = $state(false);
	let playSpeed = $state(1);

	run(() => {
		if (dtxFile) {
			dtxFile.title = title;
			dtxFile.artist = artist;
			dtxFile.comment = comment;
			dtxFile.bpm = bpm;
			dtxFile.level = level;
			store.currentDtxFile.set(dtxFile);
		}
	});

	function handleMeasureChange() {
		store.measureCount.set(measureCount);
		EventBus.emit(EventType.MEASURE_UPDATE, measureCount);
	}

	function handleGotoMeasure() {
		EventBus.emit(EventType.MEASURE_GOTO, gotoMeasure);
	}

	function handlePlaySpeedChange() {
		store.playSpeed.set(playSpeed);
	}

	function handlePlay() {
		isPreviewing = !isPreviewing;
		if (isPreviewing) {
			EventBus.emit(EventType.START_PREVIEW, bpm);
		} else {
			EventBus.emit(EventType.STOP_PREVIEW);
		}
		store.isPreviewing.set(isPreviewing);
	}

	onMount(() => {
		store.isPreviewing.subscribe((value) => {
			isPreviewing = value;
		});
		store.playSpeed.subscribe((value) => {
			playSpeed = value;
		});
		store.measureCount.subscribe((value) => {
			measureCount = value;
		});
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
	<!-- Text input fields (full width) -->
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-gray-700 2xl:w-1/3" for="title-input">Title:</label>
		<input
			id="title-input"
			class="w-[85%] rounded-md border border-gray-300 px-2 py-1 2xl:w-2/3"
			type="text"
			bind:value={title}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-gray-700 2xl:w-1/3" for="artist-input">Artist:</label>
		<input
			id="artist-input"
			class="w-[85%] rounded-md border border-gray-300 px-2 py-1 2xl:w-2/3"
			type="text"
			bind:value={artist}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-gray-700 2xl:w-1/3" for="comment-input">Comment:</label>
		<input
			id="comment-input"
			class="w-[85%] rounded-md border border-gray-300 px-2 py-1 2xl:w-2/3"
			type="text"
			bind:value={comment}
		/>
	</div>

	<!-- Numeric input fields (fixed width) -->
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-gray-700 2xl:w-1/3" for="bpm-input">BPM:</label>
		<input
			id="bpm-input"
			class="w-24 rounded-md border border-gray-300 px-2 py-1"
			type="number"
			bind:value={bpm}
			disabled={isPreviewing}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-gray-700 2xl:w-1/3" for="level-input">Level:</label>
		<input
			id="level-input"
			class="w-24 rounded-md border border-gray-300 px-2 py-1"
			type="number"
			min="0"
			max="999"
			bind:value={level}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-gray-700 2xl:w-1/3" for="measure-input"
			>Number of Measures:</label
		>
		<input
			id="measure-input"
			type="number"
			class="w-24 rounded-md border border-gray-300 px-2 py-1"
			min="0"
			max="499"
			bind:value={measureCount}
			onchange={handleMeasureChange}
			disabled={isPreviewing}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-gray-700 2xl:w-1/3" for="speed-input">Play Speed:</label>
		<input
			id="speed-input"
			type="number"
			class="w-24 rounded-md border border-gray-300 px-2 py-1"
			min="1"
			max="10"
			bind:value={playSpeed}
			onchange={handlePlaySpeedChange}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-gray-700 2xl:w-1/3" for="goto-input">Go to Measure:</label>
		<div class="flex items-center space-x-2">
			<input
				id="goto-input"
				type="number"
				class="w-24 rounded-md border border-gray-300 px-2 py-1"
				min="0"
				max="499"
				bind:value={gotoMeasure}
				disabled={isPreviewing}
			/>
			<button
				class="rounded-md border border-gray-300 px-2 py-1"
				onclick={handleGotoMeasure}
				disabled={isPreviewing}>Go</button
			>
		</div>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-gray-700 2xl:w-1/3" for="preview-button">Preview: </label>
		<button
			id="preview-button"
			class="rounded-md border border-gray-300 px-2 py-1"
			onclick={handlePlay}
			>{#if isPreviewing}<CirclePause />{:else}<Play />{/if}</button
		>
	</div>
</div>
