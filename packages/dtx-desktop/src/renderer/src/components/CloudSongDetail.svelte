<script lang="ts">
	import { Music, X, Calendar, Link, Cloud } from '@lucide/svelte';
	import type { SimfileWithDtx } from '@dtx/common';
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';

	interface Props {
		simFile: SimfileWithDtx;
	}
	let { simFile }: Props = $props();

	let workspaceState = $derived($workspaceStore);

	// A cloud simfile is "linked" when any workspace tree node references its id.
	const isLinked = (simFileId: number, nodes: TreeNode[]): boolean => {
		for (const n of nodes) {
			if (
				n.linkedSimFileId !== undefined &&
				String(n.linkedSimFileId) === String(simFileId)
			) {
				return true;
			}
			if (n.children?.length && isLinked(simFileId, n.children)) return true;
		}
		return false;
	};

	const linked = $derived(isLinked(simFile.id, workspaceState.treeStructure));
	const levels = $derived(
		(simFile.dtx_files ?? [])
			.map((f) => f.level)
			.filter((l): l is number => typeof l === 'number')
			.sort((a, b) => a - b)
	);

	const formatDate = (dateString?: string): string => {
		if (!dateString) return '—';
		// Date-only values (YYYY-MM-DD) are parsed as UTC by Date, which can shift the
		// displayed day in local time zones. Append local midnight so it stays on the same day.
		const local = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
			? new Date(`${dateString}T00:00:00`)
			: new Date(dateString);
		return local.toLocaleDateString();
	};
</script>

<div class="flex h-full flex-col">
	<header
		class="border-hairline bg-surface-2 flex items-start justify-between gap-3 border-b p-4"
	>
		<div class="min-w-0">
			<div class="text-cyan flex items-center gap-2 text-xs tracking-widest uppercase">
				<Cloud size={14} />
				Cloud simfile
			</div>
			<h2 class="font-display text-hi mt-1 truncate text-xl font-bold">{simFile.title}</h2>
			<p class="text-dim mt-0.5 truncate text-sm">{simFile.artist}</p>
		</div>
		<button
			type="button"
			class="text-faint hover:text-hi shrink-0 rounded p-1"
			aria-label="Close cloud song details"
			onclick={() => workspaceStore.closeCloudSongDetails()}
		>
			<X size={18} />
		</button>
	</header>

	<div class="flex-1 overflow-auto p-4">
		<dl class="grid grid-cols-1 gap-3 text-sm">
			<div class="border-hairline bg-surface-1 flex items-center gap-3 rounded-lg border p-3">
				<Music size={16} class="text-faint shrink-0 font-mono" />
				<span class="text-faint w-24 shrink-0">BPM</span>
				<span class="text-hi font-mono">{simFile.bpm ?? '—'}</span>
			</div>
			<div class="border-hairline bg-surface-1 flex items-center gap-3 rounded-lg border p-3">
				<Calendar size={16} class="text-faint shrink-0" />
				<span class="text-faint w-24 shrink-0">Publish date</span>
				<span class="text-hi">{formatDate(simFile.publish_date)}</span>
			</div>
			<div class="border-hairline bg-surface-1 flex items-center gap-3 rounded-lg border p-3">
				<Music size={16} class="text-faint shrink-0" />
				<span class="text-faint w-24 shrink-0">Levels</span>
				<span class="text-hi font-mono">
					{#if levels.length}{levels.join(', ')}{:else}—{/if}
				</span>
			</div>
		</dl>

		<div class="mt-4 flex flex-wrap gap-2">
			{#if linked}
				<span
					class="border-cyan/40 bg-cyan/10 text-cyan flex items-center gap-1 rounded px-2 py-1 text-xs"
				>
					<Link size={12} />
					Linked to workspace
				</span>
			{/if}
			{#if simFile.is_published}
				<span class="border-green/40 bg-green/10 text-green rounded px-2 py-1 text-xs">
					Published
				</span>
			{:else}
				<span class="bg-surface-2 text-dim rounded px-2 py-1 text-xs">Draft</span>
			{/if}
		</div>

		<p class="text-faint mt-6 text-xs leading-relaxed">
			Opening a cloud simfile in the editor requires downloading its chart content and is not
			yet available. Use the Library to play locally-linked charts.
		</p>
	</div>
</div>
