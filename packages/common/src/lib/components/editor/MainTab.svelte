<script lang="ts">
	import { run } from 'svelte/legacy';
	import { onMount } from 'svelte';
	import { DTXFile } from '../../chart/dtx';
	import { Play, CirclePause } from '@lucide/svelte/icons';

	interface Props {
		dtxFile?: DTXFile | null;
		measureCount?: number;
		isPreviewing?: boolean;
		playSpeed?: number;
		onDtxFileChange?: (dtxFile: DTXFile) => void;
		onMeasureChange?: (count: number) => void;
		onPlaySpeedChange?: (speed: number) => void;
		onGotoMeasure?: (measure: number) => void;
		onPreviewToggle?: (isPlaying: boolean, bpm: number) => void;
	}

	let {
		dtxFile = $bindable(),
		measureCount = $bindable(10),
		isPreviewing = $bindable(false),
		playSpeed = $bindable(1),
		onDtxFileChange,
		onMeasureChange,
		onPlaySpeedChange,
		onGotoMeasure,
		onPreviewToggle
	}: Props = $props();

	let title = $state('');
	let artist = $state('');
	let comment = $state('');
	let bpm = $state(120);
	let level = $state(0);
	let gotoMeasure = $state(0);

	run(() => {
		if (dtxFile) {
			dtxFile.title = title;
			dtxFile.artist = artist;
			dtxFile.comment = comment;
			dtxFile.bpm = bpm;
			dtxFile.level = level;
			onDtxFileChange?.(dtxFile);
		}
	});

	function handleMeasureChange() {
		onMeasureChange?.(measureCount);
	}

	function handleGotoMeasure() {
		onGotoMeasure?.(gotoMeasure);
	}

	function handlePlaySpeedChange() {
		onPlaySpeedChange?.(playSpeed);
	}

	function handlePlay() {
		const newPreviewState = !isPreviewing;
		isPreviewing = newPreviewState;
		onPreviewToggle?.(newPreviewState, bpm);
	}

	$effect(() => {
		if (dtxFile) {
			title = dtxFile.title ?? '';
			artist = dtxFile.artist ?? '';
			comment = dtxFile.comment ?? '';
			bpm = dtxFile.bpm ?? 120;
			level = dtxFile.level ?? 0;
		}
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
