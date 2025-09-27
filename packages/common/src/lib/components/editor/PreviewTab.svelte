<script lang="ts">
	import { EventBus } from '@dtx/common/game';
	import { EventType } from '@dtx/common/game';
	import { onMount, onDestroy } from 'svelte';
	import { store } from '@dtx/common';
	import { Play, CirclePause } from '@lucide/svelte/icons';

	interface Props {
		isEditorReady?: boolean;
	}

	let { isEditorReady = false }: Props = $props();

	let isPreviewing = $state(false);
	let playSpeed = $state(1);
	let disableBgmPreview = $state(false);
	let bpm = $state(120);

	function handlePlaySpeedChange() {
		store.playSpeed.set(playSpeed);
	}

	$effect(() => {
		store.disableBgmPreview.set(disableBgmPreview);
	});

	function handlePlay() {
		isPreviewing = !isPreviewing;
		if (isPreviewing) {
			EventBus.emit(EventType.START_PREVIEW, bpm);
		} else {
			EventBus.emit(EventType.STOP_PREVIEW);
		}
		store.isPreviewing.set(isPreviewing);
	}

	let unsubscribeFunctions: Array<() => void> = [];

	onMount(() => {
		const isPreviewingUnsubscribe = store.isPreviewing.subscribe((value) => {
			isPreviewing = value;
		});
		const playSpeedUnsubscribe = store.playSpeed.subscribe((value) => {
			playSpeed = value;
		});
		const disableBgmPreviewUnsubscribe = store.disableBgmPreview.subscribe((value) => {
			disableBgmPreview = value;
		});
		const dtxFileUnsubscribe = store.currentDtxFile.subscribe((value) => {
			bpm = value?.bpm ?? 120;
		});

		unsubscribeFunctions = [
			isPreviewingUnsubscribe,
			playSpeedUnsubscribe,
			disableBgmPreviewUnsubscribe,
			dtxFileUnsubscribe
		];
	});

	onDestroy(() => {
		unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
	});
</script>

<div class="flex flex-col space-y-4">
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="speed-input">Play Speed:</label>
		<input
			id="speed-input"
			type="number"
			class="music-input w-24"
			min="1"
			max="10"
			bind:value={playSpeed}
			onchange={handlePlaySpeedChange}
		/>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="disable-bgm-preview"
			>Disable BGM in Preview:</label
		>
		<label
			class="relative inline-flex items-center py-1 {isPreviewing
				? 'cursor-not-allowed opacity-50'
				: 'cursor-pointer'}"
		>
			<input
				id="disable-bgm-preview"
				type="checkbox"
				class="sr-only"
				bind:checked={disableBgmPreview}
				disabled={isPreviewing}
			/>
			<div class="toggle-switch {disableBgmPreview ? 'toggle-on' : 'toggle-off'}">
				<div class="toggle-thumb"></div>
			</div>
		</label>
	</div>
	<div class="flex items-center space-x-2">
		<label class="w-[15%] text-slate-300 2xl:w-1/3" for="preview-button">Preview: </label>
		<button
			id="preview-button"
			class="music-btn-primary flex h-10 w-12 items-center justify-center {!isEditorReady
				? 'cursor-not-allowed opacity-50'
				: ''}"
			onclick={handlePlay}
			disabled={!isEditorReady}
			>{#if isPreviewing}<CirclePause class="h-5 w-5" />{:else}<Play
					class="h-5 w-5"
				/>{/if}</button
		>
	</div>
</div>

<style>
	.toggle-switch {
		width: 44px;
		height: 24px;
		background-color: #475569;
		border: 1px solid rgba(139, 92, 246, 0.3);
		border-radius: 12px;
		position: relative;
		transition: all 0.2s ease;
	}

	.toggle-switch.toggle-on {
		background-color: #ef4444;
		border-color: rgba(239, 68, 68, 0.5);
		box-shadow: 0 0 10px rgba(239, 68, 68, 0.3);
	}

	.toggle-thumb {
		width: 20px;
		height: 20px;
		background-color: #f8fafc;
		border-radius: 50%;
		position: absolute;
		top: 2px;
		left: 2px;
		transition: transform 0.2s ease;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
	}

	.toggle-on .toggle-thumb {
		transform: translateX(20px);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
