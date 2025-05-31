<script lang="ts">
	import { Music, X, ArrowLeft } from '@lucide/svelte';
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';

	interface Props {
		song: TreeNode;
	}

	let { song }: Props = $props();

	const handleClose = () => {
		workspaceStore.closeSongDetails();
	};
</script>

<div class="rounded-xl bg-white p-6 shadow-md dark:bg-slate-800">
	<div
		class="mb-4 flex items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-slate-700"
	>
		<div class="flex items-center gap-2">
			<Music size={20} class="text-purple-500 dark:text-purple-400" />
			<h2 class="text-xl font-semibold">Song Details</h2>
		</div>
		<button
			class="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
			onclick={handleClose}
			tabindex="0"
			aria-label="Close song details"
		>
			<X size={16} />
		</button>
	</div>

	<div class="space-y-4">
		<!-- Song Title from SET.def -->
		{#if song.songTitle}
			<div>
				<h3 class="mb-2 text-lg font-medium text-slate-700 dark:text-slate-300">
					Song Title
				</h3>
				<div class="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
					<span class="text-lg font-semibold text-slate-800 dark:text-slate-200"
						>{song.songTitle}</span
					>
				</div>
			</div>
		{/if}

		<!-- Folder Name -->
		<div>
			<h3 class="mb-2 text-lg font-medium text-slate-700 dark:text-slate-300">Folder Name</h3>
			<div class="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
				<span class="font-mono text-sm text-slate-600 dark:text-slate-400">{song.name}</span
				>
			</div>
		</div>

		<!-- Song Path -->
		<div>
			<h3 class="mb-2 text-lg font-medium text-slate-700 dark:text-slate-300">Path</h3>
			<div class="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
				<span class="font-mono text-sm text-slate-600 dark:text-slate-400">{song.path}</span
				>
			</div>
		</div>

		<!-- Additional song information -->
		<div
			class="rounded-lg border-2 border-dashed border-slate-200 p-8 text-center dark:border-slate-700"
		>
			<Music size={48} class="mx-auto mb-4 text-slate-400" />
			<p class="mt-2 text-sm text-slate-400 dark:text-slate-500">
				Additional DTX file parsing and metadata coming soon...
			</p>
		</div>

		<!-- Back to Workspace Button -->
		<div class="pt-4">
			<button
				class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-slate-500 to-slate-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-slate-600 hover:to-slate-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
				onclick={handleClose}
				tabindex="0"
				aria-label="Back to workspace"
			>
				<ArrowLeft size={16} />
				Back to Workspace
			</button>
		</div>
	</div>
</div>
