<script lang="ts">
	import { Music, X, ArrowLeft, Link, Calendar, User } from '@lucide/svelte';
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

		<!-- Linked SimFile Information -->
		{#if song.linkedSimFile}
			<div>
				<h3
					class="mb-2 flex items-center gap-2 text-lg font-medium text-slate-700 dark:text-slate-300"
				>
					<Link size={18} class="text-green-500 dark:text-green-400" />
					Linked Remote SimFile
				</h3>
				<div class="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<span class="font-semibold text-green-800 dark:text-green-200">
								{song.linkedSimFile.title}
							</span>
							<span
								class="rounded bg-green-200 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-800 dark:text-green-200"
							>
								Linked
							</span>
						</div>
						<div
							class="flex items-center gap-4 text-sm text-green-700 dark:text-green-300"
						>
							<div class="flex items-center gap-1">
								<User size="14" />
								{song.linkedSimFile.artist}
							</div>
							<div class="flex items-center gap-1">
								<Music size="14" />
								{song.linkedSimFile.bpm} BPM
							</div>
							{#if song.linkedSimFile.publish_date}
								<div class="flex items-center gap-1">
									<Calendar size="14" />
									{new Date(song.linkedSimFile.publish_date).toLocaleDateString()}
								</div>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{:else if song.containsDtxFiles}
			<div>
				<h3 class="mb-2 text-lg font-medium text-slate-700 dark:text-slate-300">
					Remote SimFile Status
				</h3>
				<div class="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
					<div class="flex items-center gap-2">
						<Music size={16} class="text-yellow-600 dark:text-yellow-400" />
						<span class="text-sm text-yellow-800 dark:text-yellow-200">
							No linked remote simFile found. This local song is not yet uploaded to
							the cloud.
						</span>
					</div>
				</div>
			</div>
		{/if}

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
