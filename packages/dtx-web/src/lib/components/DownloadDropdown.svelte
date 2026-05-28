<script lang="ts">
	import { Download, ExternalLink } from '@lucide/svelte/icons';
	import { downloadSimfile } from '$lib/api';
	import { _ } from 'svelte-i18n';

	let {
		simfileId,
		externalUrl,
		hasUploadedFiles,
		compact = false
	} = $props<{
		simfileId: number;
		externalUrl: string | null;
		hasUploadedFiles?: boolean;
		compact?: boolean;
	}>();

	const showUploadedDownload = $derived(hasUploadedFiles === true);

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

	let isDownloading = $state(false);
	let downloadError = $state<string | null>(null);

	const handleDownload = async () => {
		if (isDownloading) return;
		isDownloading = true;
		downloadError = null;
		try {
			await downloadSimfile(String(simfileId));
		} catch (err) {
			downloadError = err instanceof Error ? err.message : 'Download failed';
		} finally {
			isDownloading = false;
		}
	};
</script>

<div class={containerClass}>
	{#if showUploadedDownload}
		<button
			type="button"
			onclick={handleDownload}
			aria-label={$_('chart_actions.download')}
			disabled={isDownloading}
			class={downloadClass}
			title="Download chart"
		>
			<Download size="16" />
			{#if !compact}{isDownloading
					? $_('chart_actions.downloading')
					: $_('chart_actions.download')}{/if}
		</button>
		{#if downloadError}
			<p class="text-sm text-red-500" role="alert">{downloadError}</p>
		{/if}
	{/if}
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
