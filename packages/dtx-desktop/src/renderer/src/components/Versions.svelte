<script lang="ts">
	import { Zap, Server } from '@lucide/svelte';
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
</script>

<div class="grid gap-3 md:grid-cols-2">
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
				<p class="text-xs text-slate-500 dark:text-slate-400">Application</p>
				<p class="font-medium">{versions.app ?? '—'}</p>
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
				<p class="text-xs text-slate-500 dark:text-slate-400">Tauri</p>
				<p class="font-medium">{versions.tauri ?? '—'}</p>
			</div>
		</div>
	</div>
</div>
