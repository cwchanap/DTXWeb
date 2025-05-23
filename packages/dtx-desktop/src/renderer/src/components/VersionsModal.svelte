<script lang="ts">
	import { Zap, Chrome, Server, Info } from '@lucide/svelte';
	import { Modal } from '@skeletonlabs/skeleton-svelte';

	const versions = window.electron.process.versions;

	// Modal state
	let openState = $state(false);

	function modalClose() {
		openState = false;
	}
</script>

<!-- Versions Modal -->
<Modal
	open={openState}
	onOpenChange={(e) => (openState = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-screen-sm"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet trigger()}
		<!-- Info button in the bottom right corner -->
		<div class="fixed right-4 bottom-4 z-10">
			<button
				class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg transition-transform hover:scale-105 focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:outline-none"
				onclick={() => (openState = true)}
				tabindex="0"
				aria-label="Show application information"
			>
				<Info size={24} />
			</button>
		</div>
	{/snippet}
	{#snippet content()}
		<header
			class="flex items-center justify-between border-b border-slate-200 pb-2 dark:border-slate-700"
		>
			<div class="flex items-center gap-2">
				<Info size={20} class="text-blue-500" />
				<h4 class="h4">Application Information</h4>
			</div>
		</header>

		<article>
			<div class="grid gap-3 md:grid-cols-3">
				<div
					class="rounded-lg border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-600 dark:bg-slate-700"
				>
					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40"
						>
							<Zap size={24} class="text-blue-600 dark:text-blue-400" />
						</div>
						<div>
							<p class="text-xs text-slate-500 dark:text-slate-400">Electron</p>
							<p class="font-medium">{versions.electron}</p>
						</div>
					</div>
				</div>

				<div
					class="rounded-lg border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-600 dark:bg-slate-700"
				>
					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40"
						>
							<Chrome size={24} class="text-blue-600 dark:text-blue-400" />
						</div>
						<div>
							<p class="text-xs text-slate-500 dark:text-slate-400">Chromium</p>
							<p class="font-medium">{versions.chrome}</p>
						</div>
					</div>
				</div>

				<div
					class="rounded-lg border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-600 dark:bg-slate-700"
				>
					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40"
						>
							<Server size={24} class="text-green-600 dark:text-green-400" />
						</div>
						<div>
							<p class="text-xs text-slate-500 dark:text-slate-400">Node.js</p>
							<p class="font-medium">{versions.node}</p>
						</div>
					</div>
				</div>
			</div>
		</article>

		<footer class="flex justify-end gap-4">
			<button type="button" class="btn preset-tonal" onclick={modalClose}> Close </button>
		</footer>
	{/snippet}
</Modal>
