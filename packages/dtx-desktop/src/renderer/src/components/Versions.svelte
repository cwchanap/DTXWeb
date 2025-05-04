<script lang="ts">
	import { Zap, Chrome, Server } from '@lucide/svelte';
	const versions = window.electron.process.versions;
</script>

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
