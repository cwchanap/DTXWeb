<script lang="ts">
	import { ArrowLeft } from '@lucide/svelte';
	interface Props {
		songName: string | null;
		simFileId?: string;
		difficulties: { name: string }[];
		currentDtx: string;
		onBack: () => void;
		onSwitchDifficulty: (name: string) => void;
	}
	let { songName, simFileId, difficulties, currentDtx, onBack, onSwitchDifficulty }: Props =
		$props();
	const title = $derived(
		songName ? `· ${songName}` : simFileId ? `· ${simFileId}` : '· New Chart'
	);
</script>

<div class="border-hairline bg-surface-1 flex h-12 items-center gap-4 border-b px-4">
	<button
		class="bg-surface-2 text-base-text hover:text-hi flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
		onclick={onBack}
		aria-label="Back to library"><ArrowLeft size={15} /> Back</button
	>
	<h1 class="font-display text-hi text-sm font-semibold">
		DTX EDITOR <span class="text-dim">{title}</span>
	</h1>
	{#if difficulties.length > 1}
		<select
			class="border-hairline bg-surface-2 font-mono-alt text-hi focus:border-cyan ml-auto rounded-lg border px-3 py-1.5 text-xs focus:outline-none"
			value={currentDtx}
			onchange={(e) => onSwitchDifficulty((e.target as HTMLSelectElement).value)}
			aria-label="Difficulty"
		>
			{#each difficulties as d}<option value={d.name}
					>{d.name.replace('.dtx', '').toUpperCase()}</option
				>{/each}
		</select>
	{/if}
</div>
