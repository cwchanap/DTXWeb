<script lang="ts">
	import { Settings as SettingsIcon, Folder, Save, RotateCcw } from '@lucide/svelte';
	import { settingsStore, type Settings } from '../stores/settingsStore';
	import { onMount } from 'svelte';
	import { desktopHost } from '../services/desktopHost';

	let settings = $state<Settings>();
	let isSelectingDirectory = $state(false);
	let saveSuccess = $state(false);

	// Subscribe to settings store and initialize with current store value
	const unsubscribe = settingsStore.subscribe((value) => {
		settings = { ...value };
	});

	// Handle directory selection
	const handleSelectDirectory = async () => {
		if (isSelectingDirectory) return;

		isSelectingDirectory = true;
		try {
			const result = await desktopHost.selectFolder();
			if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
				const newDirectory = result.filePaths[0];
				settings = { ...settings, exportDirectory: newDirectory };
				settingsStore.updateExportDirectory(newDirectory);
				showSaveSuccess();
			}
		} catch (error) {
			console.error('Error selecting directory:', error);
		} finally {
			isSelectingDirectory = false;
		}
	};

	// Handle reset to default
	const handleResetToDefault = async () => {
		await settingsStore.reset();
		showSaveSuccess();
	};

	// Show save success message
	const showSaveSuccess = () => {
		saveSuccess = true;
		setTimeout(() => {
			saveSuccess = false;
		}, 2000);
	};

	onMount(() => {
		return unsubscribe;
	});
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div
		class="flex items-center justify-between gap-2 border-b border-slate-200 p-6 pb-4 dark:border-slate-700"
	>
		<div class="flex items-center gap-2">
			<SettingsIcon size={20} class="text-slate-500 dark:text-slate-400" />
			<h2 class="text-xl font-semibold">Settings</h2>
		</div>
	</div>

	<!-- Content -->
	<div class="flex-1 overflow-auto p-6">
		<div class="mx-auto max-w-2xl space-y-6">
			<!-- Export Settings Section -->
			<div class="rounded-lg bg-white p-6 shadow-sm dark:bg-slate-800">
				<h3 class="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
					Export Settings
				</h3>

				<!-- Export Directory Setting -->
				<div class="space-y-3">
					<label
						for="export-directory-display"
						class="block text-sm font-medium text-slate-700 dark:text-slate-300"
					>
						Default Export Directory
					</label>
					<p class="text-sm text-slate-600 dark:text-slate-400">
						Choose where exported ZIP files will be saved by default.
					</p>

					<div class="flex items-center gap-3">
						<div class="flex-1">
							<div
								id="export-directory-display"
								class="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
							>
								<Folder size={16} class="mr-2 text-slate-400" />
								<span
									class="flex-1 truncate font-mono text-sm text-slate-700 dark:text-slate-300"
								>
									{settings?.exportDirectory || '~/Downloads'}
								</span>
							</div>
						</div>
						<button
							class="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
							onclick={handleSelectDirectory}
							disabled={isSelectingDirectory}
						>
							{#if isSelectingDirectory}
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								></div>
								Selecting...
							{:else}
								<Folder size={16} />
								Browse
							{/if}
						</button>
					</div>

					<!-- Reset to Default Button -->
					<button
						class="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
						onclick={handleResetToDefault}
					>
						<RotateCcw size={14} />
						Reset to Default
					</button>
				</div>
			</div>

			<!-- Success Message -->
			{#if saveSuccess}
				<div
					class="rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-900/20 dark:text-green-300"
				>
					<div class="flex items-center gap-2">
						<Save size={16} />
						<span class="text-sm font-medium">Settings saved successfully!</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
