<script lang="ts">
	import { workspaceStore } from '../stores/workspaceStore';
	import { Folder, ArrowLeft, Music } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let songName = $state('');
	let folderName = $state('');
	let selectedPath = $state('');
	let useSameNameForFolder = $state(true);
	let isCreating = $state(false);
	let error = $state('');
	let availableFolders = $state<string[]>([]);

	// Subscribe to workspace store to get available folders
	let workspaceState = $derived($workspaceStore);

	onMount(() => {
		// Get list of available folders from workspace state
		if (workspaceState.path) {
			loadAvailableFolders();
		}
	});

	async function loadAvailableFolders() {
		try {
			const folders = await window.electron.ipcRenderer.invoke(
				'get-subdirectories',
				workspaceState.path
			);
			availableFolders = folders;

			// Set default selection to first folder if available
			if (folders.length > 0) {
				selectedPath = folders[0];
			}
		} catch (err) {
			console.error('Failed to load available folders:', err);
			error = 'Failed to load available folders';
		}
	}

	function goBack() {
		workspaceStore.closeNewSongForm();
	}

	async function createSong() {
		if (!songName.trim()) {
			error = 'Please enter a song name';
			return;
		}

		if (!selectedPath) {
			error = 'Please select a folder path';
			return;
		}

		// Determine the actual folder name to use
		const actualFolderName = useSameNameForFolder ? songName.trim() : folderName.trim();

		if (!actualFolderName) {
			error = 'Please enter a folder name';
			return;
		}

		isCreating = true;
		error = '';

		try {
			// Create the song folder path
			const songFolderPath = `${selectedPath}/${actualFolderName}`;

			// Create the folder
			await window.electron.ipcRenderer.invoke('create-directory', songFolderPath);

			// Create SET.def file content
			const setDefContent = `#TITLE: ${songName.trim()}`;
			const setDefPath = `${songFolderPath}/SET.def`;

			// Write the SET.def file
			await window.electron.ipcRenderer.invoke('write-file', setDefPath, setDefContent);

			// Refresh workspace tree to show new folder
			if (workspaceState.path) {
				const updatedTree = await window.electron.ipcRenderer.invoke(
					'get-tree-structure',
					workspaceState.path
				);
				workspaceStore.setTreeStructure(updatedTree);
			}

			// Navigate back to workspace
			workspaceStore.closeNewSongForm();
		} catch (err) {
			console.error('Failed to create song folder:', err);
			error = err instanceof Error ? err.message : 'Failed to create song folder';
		} finally {
			isCreating = false;
		}
	}

	async function selectCustomPath() {
		try {
			const result = await window.electron.ipcRenderer.invoke('select-folder');
			if (result && !result.canceled && result.filePaths.length > 0) {
				selectedPath = result.filePaths[0];
			}
		} catch (err) {
			console.error('Failed to select folder:', err);
			error = 'Failed to select folder';
		}
	}
</script>

<div class="flex h-full flex-col overflow-hidden bg-white dark:bg-slate-800">
	<!-- Header -->
	<div
		class="flex items-center justify-between gap-2 border-b border-slate-200 p-6 pb-4 dark:border-slate-700"
	>
		<div class="flex items-center gap-2">
			<button
				onclick={goBack}
				class="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
			>
				<ArrowLeft size={16} />
				Back
			</button>
		</div>
		<div class="flex items-center gap-2">
			<Music size={20} class="text-slate-500" />
			<h2 class="text-xl font-semibold">Create New Song</h2>
		</div>
		<div class="w-20"></div>
		<!-- Spacer for centering -->
	</div>

	<!-- Main Content -->
	<div class="flex flex-1 items-center justify-center p-6">
		<div
			class="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-600 dark:bg-slate-700"
		>
			<div class="mb-6 text-center">
				<h3 class="text-lg font-semibold text-slate-900 dark:text-slate-100">
					New Song Folder
				</h3>
			</div>

			{#if error}
				<div
					class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
				>
					{error}
				</div>
			{/if}

			<form
				onsubmit={(e) => {
					e.preventDefault();
					createSong();
				}}
				class="space-y-4"
			>
				<!-- Song Name Input -->
				<div>
					<label
						for="songName"
						class="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
					>
						Song Name
					</label>
					<input
						id="songName"
						type="text"
						bind:value={songName}
						placeholder="Enter song name..."
						required
						class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
					/>
				</div>

				<!-- Use Same Name Checkbox -->
				<div class="flex items-center gap-2">
					<input
						id="useSameName"
						type="checkbox"
						bind:checked={useSameNameForFolder}
						class="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
					/>
					<label for="useSameName" class="text-sm text-slate-700 dark:text-slate-300">
						Use same name for folder
					</label>
				</div>

				<!-- Folder Name Input (only show when checkbox is unchecked) -->
				{#if !useSameNameForFolder}
					<div>
						<label
							for="folderName"
							class="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
						>
							Folder Name
						</label>
						<input
							id="folderName"
							type="text"
							bind:value={folderName}
							placeholder="Enter folder name..."
							required
							class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
						/>
					</div>
				{/if}

				<!-- Folder Path Selection -->
				<div>
					<label
						for="folderPath"
						class="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
					>
						Destination Folder
					</label>

					{#if availableFolders.length > 0}
						<select
							id="folderPath"
							bind:value={selectedPath}
							required
							class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
						>
							{#each availableFolders as folder}
								<option value={folder}>{folder.split('/').pop() || folder}</option>
							{/each}
						</select>
					{:else}
						<div class="text-sm text-slate-600 dark:text-slate-400">
							No workspace folders available
						</div>
					{/if}

					<button
						type="button"
						onclick={selectCustomPath}
						class="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
					>
						<Folder size={14} />
						Choose different folder...
					</button>
				</div>

				<!-- Selected Path Display -->
				{#if selectedPath}
					<div class="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
						<p class="text-xs text-slate-600 dark:text-slate-400">Full path:</p>
						<p class="font-mono text-sm text-slate-800 dark:text-slate-200">
							{selectedPath}/{(useSameNameForFolder ? songName : folderName) ||
								'[folder-name]'}
						</p>
					</div>
				{/if}

				<!-- Action Buttons -->
				<div class="flex gap-3 pt-2">
					<button
						type="button"
						onclick={goBack}
						class="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isCreating || !songName.trim() || !selectedPath}
						class="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-800"
					>
						{#if isCreating}
							Creating...
						{:else}
							Create Song
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
</div>
