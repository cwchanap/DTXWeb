<script lang="ts">
	import { Download, ExternalLink } from '@lucide/svelte/icons';

	let {
		simfileId,
		externalUrl,
		compact = false
	} = $props<{
		simfileId: number;
		externalUrl: string | null;
		compact?: boolean;
	}>();

	const containerClass = $derived(compact ? 'flex items-center gap-1' : 'flex flex-col gap-2');
	const downloadClass = $derived(
		compact
			? 'inline-flex items-center justify-center rounded-full bg-blue-100 p-2 text-blue-600 hover:bg-blue-200'
			: 'music-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm'
	);
	const externalActiveClass = $derived(
		compact
			? 'inline-flex items-center justify-center rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200'
			: 'inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 transition-colors duration-200 hover:border-purple-500/50 hover:text-purple-300'
	);
	const externalDisabledClass = $derived(
		compact
			? 'inline-flex cursor-not-allowed items-center justify-center rounded-full p-2 text-slate-300 opacity-50'
			: 'inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-600 opacity-50'
	);
</script>

<div class={containerClass}>
	<a
		href="/api/simFile/download/{simfileId}"
		download="chart-{simfileId}.zip"
		class={downloadClass}
		aria-label="Download chart"
		title="Download chart"
	>
		<Download size="16" />
		{#if !compact}Download{/if}
	</a>
	{#if externalUrl}
		<a
			href={externalUrl}
			target="_blank"
			rel="noopener noreferrer"
			class={externalActiveClass}
			aria-label="External download link"
			title="External download link"
		>
			<ExternalLink size="16" />
			{#if !compact}External Link{/if}
		</a>
	{:else}
		<span class={externalDisabledClass} aria-disabled="true" title="No external link available">
			<ExternalLink size="16" />
			{#if !compact}External Link{/if}
		</span>
	{/if}
</div>
