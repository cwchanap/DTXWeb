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
		class="border-hairline bg-surface-1 flex items-center justify-between gap-2 border-b p-6 pb-4"
	>
		<div class="flex items-center gap-2">
			<SettingsIcon size={20} class="text-dim" />
			<h2 class="font-display text-hi text-xl font-semibold">Settings</h2>
		</div>
	</div>

	<!-- Content -->
	<div class="flex-1 overflow-auto p-6">
		<div class="mx-auto max-w-2xl space-y-6">
			<!-- Export Settings Section -->
			<div class="bg-surface-1 rounded-lg p-6 shadow-sm">
				<h3 class="font-display text-hi mb-4 text-lg font-semibold">Export Settings</h3>

				<!-- Export Directory Setting -->
				<div class="space-y-3">
					<label
						for="export-directory-display"
						class="text-base-text block text-sm font-medium"
					>
						Default Export Directory
					</label>
					<p class="text-dim text-sm">
						Choose where exported ZIP files will be saved by default.
					</p>

					<div class="flex items-center gap-3">
						<div class="flex-1">
							<div
								id="export-directory-display"
								class="border-hairline bg-surface-2 flex items-center rounded-lg border px-3 py-2"
							>
								<Folder size={16} class="text-faint mr-2" />
								<span class="text-base-text flex-1 truncate font-mono text-sm">
									{settings?.exportDirectory || '~/Downloads'}
								</span>
							</div>
						</div>
						<button
							class="bg-magenta flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[#16001a] transition-colors hover:opacity-90 focus:outline-none disabled:opacity-50"
							style="box-shadow:0 0 22px -6px var(--color-magenta)"
							onclick={handleSelectDirectory}
							disabled={isSelectingDirectory}
						>
							{#if isSelectingDirectory}
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-[#16001a] border-t-transparent"
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
						class="text-dim hover:text-base-text flex items-center gap-2 text-sm"
						onclick={handleResetToDefault}
					>
						<RotateCcw size={14} />
						Reset to Default
					</button>
				</div>
			</div>

			<!-- Success Message -->
			{#if saveSuccess}
				<div class="border-green/40 bg-green/10 rounded-lg p-4">
					<div class="text-green flex items-center gap-2">
						<Save size={16} />
						<span class="text-sm font-medium">Settings saved successfully!</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
