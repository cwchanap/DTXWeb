<script lang="ts">
	import { run } from 'svelte/legacy';

	import { EventBus } from '@dtx/common/game';
	import { EventType } from '@dtx/common/game';
	import { onMount } from 'svelte';
	import { store } from '@dtx/common';
	import { DTXFile } from '@dtx/common';
	import { ToggleGroup } from '@dtx/ui-components';

	let dtxFile: DTXFile | null = $state(null);
	let measureCount = $state(10);
	let title = $state('');
	let artist = $state('');
	let comment = $state('');
	let bpm = $state(120);
	let level = $state(0);
	let gotoMeasure = $state(0);
	let isPreviewing = $state(false);
	let gridSpacing = $state(16);
	let cellHeight = $state(25); // Default cell height in pixels

	const gridSpacingOptions = [
		{ value: 8, label: '8th' },
		{ value: 12, label: '12th' },
		{ value: 16, label: '16th' },
		{ value: 24, label: '24th' },
		{ value: 48, label: '48th' },
		{ value: 64, label: '64th' }
	];

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

	function handleGridSpacingChange() {
		EventBus.emit(EventType.GRID_SPACING_UPDATE, gridSpacing);
	}

	function handleCellHeightApply() {
		// Validate cell height range
		if (cellHeight < 5 || cellHeight > 100) {
			EventBus.emit(
				EventType.VALIDATION_ERROR,
				'Cell height must be between 5 and 100 pixels'
			);
			return;
		}
		EventBus.emit(EventType.CELL_HEIGHT_UPDATE, cellHeight);
	}

	$effect(() => {
		handleGridSpacingChange();
	});

	onMount(() => {
		const unsubPreview = store.isPreviewing.subscribe((value) => {
			isPreviewing = value;
		});
		const unsubMeasure = store.measureCount.subscribe((value) => {
			measureCount = value;
		});
		const dtxFileUnsubscribe = store.currentDtxFile.subscribe((value) => {
			dtxFile = value;
			title = dtxFile?.title ?? '';
			artist = dtxFile?.artist ?? '';
			comment = dtxFile?.comment ?? '';
			bpm = dtxFile?.bpm ?? 0;
			level = dtxFile?.level ?? 0;
		});

		// Cleanup function
		return () => {
			unsubPreview();
			unsubMeasure();
			dtxFileUnsubscribe();
		};
	});
</script>

<div class="flex flex-col space-y-2">
	<!-- Text input fields (full width) -->
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="title-input">Title:</label>
		<input
			id="title-input"
			class="music-input w-[85%] 2xl:w-2/3"
			type="text"
			bind:value={title}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="artist-input">Artist:</label>
		<input
			id="artist-input"
			class="music-input w-[85%] 2xl:w-2/3"
			type="text"
			bind:value={artist}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="comment-input">Comment:</label>
		<input
			id="comment-input"
			class="music-input w-[85%] 2xl:w-2/3"
			type="text"
			bind:value={comment}
		/>
	</div>

	<!-- Numeric input fields (fixed width) -->
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="bpm-input">BPM:</label>
		<input
			id="bpm-input"
			class="music-input w-24"
			type="number"
			bind:value={bpm}
			disabled={isPreviewing}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="level-input">Level:</label>
		<input
			id="level-input"
			class="music-input w-24"
			type="number"
			min="0"
			max="999"
			bind:value={level}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="measure-input"
			>Number of Measures:</label
		>
		<input
			id="measure-input"
			type="number"
			class="music-input w-24"
			min="0"
			max="499"
			bind:value={measureCount}
			onchange={handleMeasureChange}
			disabled={isPreviewing}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="grid-spacing">Grid Spacing:</label>
		<ToggleGroup
			options={gridSpacingOptions}
			bind:value={gridSpacing}
			size="sm"
			variant="outline"
			ariaLabel="Select grid spacing for note placement"
			disabled={isPreviewing}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="cell-height-input">Cell Height:</label>
		<div class="flex items-center space-x-2">
			<input
				id="cell-height-input"
				type="number"
				class="music-input w-16"
				min="5"
				max="100"
				bind:value={cellHeight}
				onkeydown={(e) => e.key === 'Enter' && handleCellHeightApply()}
				disabled={isPreviewing}
			/>
			<span class="text-xs text-slate-400">px</span>
			<button
				class="music-btn-secondary px-2 py-1 text-sm"
				onclick={handleCellHeightApply}
				disabled={isPreviewing}
			>
				Apply
			</button>
		</div>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="goto-input">Go to Measure:</label>
		<div class="flex items-center space-x-2">
			<input
				id="goto-input"
				type="number"
				class="music-input w-24"
				min="0"
				max="499"
				bind:value={gotoMeasure}
				disabled={isPreviewing}
			/>
			<button
				class="music-btn-secondary px-2 py-1"
				onclick={handleGotoMeasure}
				disabled={isPreviewing}>Go</button
			>
		</div>
	</div>
</div>
