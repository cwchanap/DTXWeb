<script lang="ts">
	import { Zap, Server, Info } from '@lucide/svelte';
	import Modal from '@dtx/ui-components/components/Modal.svelte';
	import { onMount } from 'svelte';
	import { desktopHost, type DesktopHostVersions } from '../services/desktopHost';

	let versions = $state<DesktopHostVersions>({ app: null, tauri: null });

	onMount(async () => {
		try {
			versions = await desktopHost.getVersions();
		} catch {
			// keep default nulls on failure
		}
	});

	// Modal state
	let openState = $state(false);

	function modalClose() {
		openState = false;
	}
</script>

<!-- Info button in the bottom right corner -->
<div class="fixed right-4 bottom-4 z-10">
	<button
		class="bg-magenta flex h-12 w-12 items-center justify-center rounded-full text-[#16001a] shadow-lg transition-transform hover:scale-105 focus:ring-2 focus:ring-offset-2 focus:outline-none"
		style="box-shadow:0 0 22px -6px var(--color-magenta)"
		onclick={() => (openState = true)}
		aria-label="Show application information"
	>
		<Info size={24} />
	</button>
</div>

<!-- Versions Modal -->
<Modal bind:open={openState} title="Application Information" size="lg">
	{#snippet children()}
		<article>
			<div class="grid gap-3 md:grid-cols-2">
				<div
					class="border-hairline bg-surface-1 rounded-lg border p-4 shadow-sm transition-shadow hover:shadow-md"
				>
					<div class="flex items-center gap-3">
						<div
							class="bg-surface-2 flex h-10 w-10 items-center justify-center rounded-full"
						>
							<Zap size={24} class="text-cyan" />
						</div>
						<div>
							<p class="text-faint text-xs">Application</p>
							<p class="text-hi font-medium">{versions.app ?? '—'}</p>
						</div>
					</div>
				</div>

				<div
					class="border-hairline bg-surface-1 rounded-lg border p-4 shadow-sm transition-shadow hover:shadow-md"
				>
					<div class="flex items-center gap-3">
						<div
							class="bg-surface-2 flex h-10 w-10 items-center justify-center rounded-full"
						>
							<Server size={24} class="text-green" />
						</div>
						<div>
							<p class="text-faint text-xs">Tauri</p>
							<p class="text-hi font-medium">{versions.tauri ?? '—'}</p>
						</div>
					</div>
				</div>
			</div>
		</article>

		<footer class="mt-6 flex justify-end gap-4">
			<button type="button" class="btn preset-tonal" onclick={modalClose}> Close </button>
		</footer>
	{/snippet}
</Modal>
