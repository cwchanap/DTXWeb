<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { MainTab, SoundTab, PreviewTab } from '@dtx/common/components';

	interface Props {
		simfileId: string | null;
		bucketUrl?: string;
		isEditorReady?: boolean;
		chartLoadError?: string | null;
		validationError?: string | null;
	}
	let {
		simfileId,
		bucketUrl = '',
		isEditorReady = false,
		chartLoadError = null,
		validationError = null
	}: Props = $props();

	let open = $state({ main: true, sound: true, playback: false });
	const toggle = (k: 'main' | 'sound' | 'playback') => (open[k] = !open[k]);
</script>

<div class="bg-surface-1 flex h-full flex-col gap-2 overflow-auto p-3">
	<section>
		<button
			class="bg-surface-2 font-display text-hi flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs tracking-widest"
			onclick={() => toggle('main')}
			aria-expanded={open.main}
			aria-label="Chart Info"
		>
			CHART INFO <ChevronDown
				size={15}
				class={open.main ? 'rotate-180 transition' : 'transition'}
			/>
		</button>
		{#if open.main}
			<div class="p-3">
				{#if chartLoadError}<div
						class="border-red/40 bg-red/10 text-red mb-3 rounded-md border p-2 text-xs"
					>
						{chartLoadError}
					</div>{/if}
				{#if validationError}<div
						class="border-red/40 bg-red/10 text-red mb-3 rounded-md border p-2 text-xs"
					>
						{validationError}
					</div>{/if}
				<MainTab />
			</div>
		{/if}
	</section>
	<section>
		<button
			class="bg-surface-2 font-display text-hi flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs tracking-widest"
			onclick={() => toggle('sound')}
			aria-expanded={open.sound}
			aria-label="Sounds"
		>
			SOUNDS <ChevronDown
				size={15}
				class={open.sound ? 'rotate-180 transition' : 'transition'}
			/>
		</button>
		{#if open.sound}<div class="p-3"><SoundTab simfileID={simfileId} {bucketUrl} /></div>{/if}
	</section>
	<section>
		<button
			class="bg-surface-2 font-display text-hi flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs tracking-widest"
			onclick={() => toggle('playback')}
			aria-expanded={open.playback}
			aria-label="Playback"
		>
			PLAYBACK <ChevronDown
				size={15}
				class={open.playback ? 'rotate-180 transition' : 'transition'}
			/>
		</button>
		{#if open.playback}<div class="p-3"><PreviewTab {isEditorReady} /></div>{/if}
	</section>
</div>
