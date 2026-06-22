<script lang="ts">
	import { Play, Square } from '@lucide/svelte';
	import { store } from '@dtx/common';
	import { EventBus, EventType } from '@dtx/common/game';

	interface Props {
		isEditorReady?: boolean;
	}
	let { isEditorReady = false }: Props = $props();

	let isPreviewing = $state(false);
	let bpm = $state(120);
	let measures = $state(0);
	let zoom = $state(20);

	$effect(() => {
		const u1 = store.isPreviewing.subscribe((v) => (isPreviewing = v));
		const u2 = store.currentDtxFile.subscribe((v) => (bpm = v?.bpm ?? 120));
		const u3 = store.measureCount.subscribe((v) => (measures = v));
		return () => {
			u1();
			u2();
			u3();
		};
	});

	const handlePlay = () => {
		const next = !isPreviewing;
		store.isPreviewing.set(next);
		if (next) EventBus.emit(EventType.START_PREVIEW, bpm);
		else EventBus.emit(EventType.STOP_PREVIEW);
	};
	const handleZoom = (e: Event) => {
		zoom = Number((e.target as HTMLInputElement).value);
		EventBus.emit(EventType.CELL_HEIGHT_UPDATE, zoom);
	};
</script>

<div
	class="border-magenta bg-surface-2 flex h-16 items-center gap-6 border-t px-5"
	style="box-shadow:0 -10px 30px -20px var(--color-magenta)"
>
	<button
		class="border-magenta text-magenta flex h-10 w-10 items-center justify-center rounded-full border disabled:opacity-40"
		style="box-shadow:0 0 18px -4px var(--color-magenta)"
		onclick={handlePlay}
		disabled={!isEditorReady}
		aria-label={isPreviewing ? 'Stop preview' : 'Play preview'}
	>
		{#if isPreviewing}<Square size={16} />{:else}<Play size={16} />{/if}
	</button>
	<div class="flex flex-col">
		<span class="font-display text-faint text-[9px] tracking-widest">BPM</span>
		<span class="text-hi font-mono text-base">{bpm}</span>
	</div>
	<div class="flex flex-col">
		<span class="font-display text-faint text-[9px] tracking-widest">MEASURES</span>
		<span class="text-hi font-mono text-base">{measures}</span>
	</div>
	<label
		class="font-display text-dim ml-auto flex items-center gap-2 text-[10px] tracking-widest"
	>
		ZOOM
		<input
			type="range"
			min="8"
			max="48"
			value={zoom}
			oninput={handleZoom}
			aria-label="Zoom"
			class="accent-cyan"
		/>
	</label>
</div>
