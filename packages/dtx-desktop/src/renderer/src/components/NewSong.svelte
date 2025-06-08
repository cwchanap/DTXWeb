<script lang="ts">
	import { workspaceStore } from '../stores/workspaceStore';
	import { templateStore, type Template } from '../stores/templateStore';
	import { Folder, ArrowLeft, Music, FileText, X } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let songName = $state('');
	let folderName = $state('');
	let selectedPath = $state('');
	let useSameNameForFolder = $state(true);
	let isCreating = $state(false);
	let error = $state('');
	let availableFolders = $state<string[]>([]);
	let selectedTemplate = $state<Template | null>(null);
	let showTemplateSelection = $state(false);
	let templates = $state<Template[]>([]);
	let folderExistsWarning = $state('');

	// Subscribe to workspace store to get available folders
	let workspaceState = $derived($workspaceStore);

	// Subscribe to template store
	const unsubscribeTemplate = templateStore.subscribe((state) => {
		templates = state.templates;
	});

	// Check if folder already exists when user types (with debouncing and cancellation)
	let debounceTimer: NodeJS.Timeout | null = null;
	let currentCheckId = 0;

	$effect(() => {
		// Clear any existing timer
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		// Increment check ID to invalidate any pending requests
		const checkId = ++currentCheckId;

		const checkFolderExists = async () => {
			// Check if this request is still current
			if (checkId !== currentCheckId) {
				return; // Request has been superseded, ignore
			}

			if (!selectedPath || (!songName.trim() && !folderName.trim())) {
				folderExistsWarning = '';
				return;
			}

			const rawFolderName = useSameNameForFolder ? songName.trim() : folderName.trim();
			const sanitizedFolderName = sanitizeName(rawFolderName);

			if (!sanitizedFolderName) {
				folderExistsWarning = '';
				return;
			}

			try {
				const folderExists = await window.electron.ipcRenderer.invoke(
					'path-exists',
					selectedPath,
					sanitizedFolderName
				);

				// Check again if this request is still current after the async call
				if (checkId !== currentCheckId) {
					return; // Request has been superseded, ignore result
				}

				if (folderExists) {
					folderExistsWarning = `A folder named "${sanitizedFolderName}" already exists`;
				} else {
					folderExistsWarning = '';
				}
			} catch (err) {
				// Only update warning if this request is still current
				if (checkId === currentCheckId) {
					folderExistsWarning = '';
				}
			}
		};

		// Debounce the check by 300ms to avoid excessive API calls
		debounceTimer = setTimeout(checkFolderExists, 300);

		// Cleanup function to clear timer when effect is destroyed
		return () => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
		};
	});

	/**
	 * Sanitizes a file or folder name to prevent directory traversal attacks
	 * and ensure valid directory names
	 */
	function sanitizeName(name: string): string {
		if (!name || typeof name !== 'string') {
			return '';
		}

		// Remove leading/trailing whitespace
		let sanitized = name.trim();

		// Remove or replace dangerous path traversal sequences
		sanitized = sanitized.replace(/\.\.+/g, ''); // Remove .. sequences
		sanitized = sanitized.replace(/[\/\\]/g, ''); // Remove path separators

		// Remove or replace invalid filename characters (Windows + Unix)
		// Invalid characters: < > : " | ? * and control characters (0-31, 127)
		sanitized = sanitized.replace(/[<>:"|?*\x00-\x1f\x7f]/g, '');

		// Remove leading dots and spaces (Windows restriction)
		sanitized = sanitized.replace(/^[.\s]+/, '');

		// Remove trailing dots and spaces (Windows restriction)
		sanitized = sanitized.replace(/[.\s]+$/, '');

		// Handle reserved names on Windows
		const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
		if (reservedNames.test(sanitized)) {
			sanitized = sanitized + '_safe';
		}

		// Ensure the name is not empty after sanitization
		if (!sanitized) {
			sanitized = 'untitled';
		}

		// Limit length to prevent filesystem issues (255 is common limit)
		if (sanitized.length > 200) {
			sanitized = sanitized.substring(0, 200);
		}

		return sanitized;
	}

	onMount(() => {
		// Get list of available folders from workspace state
		if (workspaceState.path) {
			loadAvailableFolders();
		}

		// Cleanup function for template store subscription
		return () => {
			unsubscribeTemplate();
		};
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

		// Sanitize the song name
		const sanitizedSongName = sanitizeName(songName);
		if (!sanitizedSongName) {
			error = 'Song name contains only invalid characters';
			return;
		}

		// Determine the actual folder name to use
		const rawFolderName = useSameNameForFolder ? songName.trim() : folderName.trim();
		const sanitizedFolderName = sanitizeName(rawFolderName);

		if (!sanitizedFolderName) {
			error = 'Folder name contains only invalid characters or is empty';
			return;
		}

		// Check if sanitization changed the names significantly and warn user
		const originalFolderName = useSameNameForFolder ? songName.trim() : folderName.trim();
		if (sanitizedFolderName !== originalFolderName.trim()) {
			console.warn('Folder name was sanitized for security:', {
				original: originalFolderName,
				sanitized: sanitizedFolderName
			});
		}

		// Check if folder already exists
		const folderExists = await window.electron.ipcRenderer.invoke(
			'path-exists',
			selectedPath,
			sanitizedFolderName
		);
		if (folderExists) {
			error = `A folder named "${sanitizedFolderName}" already exists in the selected location`;
			return;
		}

		isCreating = true;
		error = '';

		try {
			// Create the song using the consolidated IPC call
			const result = await window.electron.ipcRenderer.invoke('create-song', {
				selectedPath,
				sanitizedFolderName,
				sanitizedSongName,
				templateFolderPath: selectedTemplate?.folderPath || null
			});

			console.log('Song created successfully:', result);

			// Refresh workspace tree to show new folder
			if (workspaceState.path) {
				const updatedTree = await window.electron.ipcRenderer.invoke(
					'load-tree-structure',
					workspaceState.path
				);
				workspaceStore.setTreeStructure(updatedTree);
			}

			// Navigate back to workspace
			workspaceStore.closeNewSongForm();
		} catch (err) {
			console.error('Failed to create song:', err);
			error = err instanceof Error ? err.message : 'Failed to create song';
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

	function handleImportTemplate() {
		showTemplateSelection = true;
		error = '';
	}

	function handleSelectTemplate(template: Template) {
		console.log('Template selected:', template);
		selectedTemplate = template;
		showTemplateSelection = false;

		// Auto-populate song name from template folder name if not already filled
		if (!songName.trim()) {
			songName = template.name;
		}
	}

	function handleClearTemplate() {
		selectedTemplate = null;
	}

	function handleCancelTemplateSelection() {
		showTemplateSelection = false;
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

			{#if folderExistsWarning}
				<div
					class="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
				>
					⚠️ {folderExistsWarning}
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

				<!-- Template Import Section -->
				<div>
					<label
						for="template"
						class="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
					>
						Template (Optional)
					</label>

					{#if selectedTemplate}
						<!-- Show selected template -->
						<div
							class="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/30"
						>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<FileText
										size={16}
										class="text-green-600 dark:text-green-400"
									/>
									<span
										class="text-sm font-medium text-green-800 dark:text-green-200"
									>
										{selectedTemplate.name}
									</span>
								</div>
								<button
									type="button"
									onclick={handleClearTemplate}
									class="flex items-center gap-1 rounded-lg bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
									title="Remove template"
								>
									<X size={12} />
								</button>
							</div>
							<p class="mt-1 text-xs text-green-700 dark:text-green-300">
								Template files will be copied to the new song folder
							</p>
						</div>
					{:else}
						<!-- Import template button -->
						<button
							id="template"
							type="button"
							onclick={handleImportTemplate}
							class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400 dark:hover:border-blue-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
						>
							<FileText size={16} />
							Import Template
						</button>
					{/if}
				</div>

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
						disabled={isCreating ||
							!songName.trim() ||
							!selectedPath ||
							!!folderExistsWarning}
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

<!-- Template Selection Modal -->
{#if showTemplateSelection}
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
		<div
			class="max-h-[80vh] w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-800"
		>
			<!-- Modal Header -->
			<div class="border-b border-slate-200 p-4 dark:border-slate-700">
				<div class="flex items-center justify-between">
					<h3 class="text-lg font-semibold text-slate-900 dark:text-slate-100">
						Select Template
					</h3>
					<button
						onclick={handleCancelTemplateSelection}
						class="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
					>
						<X size={20} />
					</button>
				</div>
			</div>

			<!-- Modal Content -->
			<div class="max-h-[60vh] overflow-y-auto p-4">
				{#if templates.length === 0}
					<div class="flex flex-col items-center py-8 text-center">
						<FileText size={48} class="mb-3 text-slate-400" />
						<p class="text-slate-600 dark:text-slate-400">
							No templates available. Create a template first in the Templates
							section.
						</p>
					</div>
				{:else}
					<div class="space-y-3">
						{#each templates as template (template.id)}
							<button
								onclick={() => handleSelectTemplate(template)}
								class="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-600 dark:hover:bg-blue-900/30"
							>
								<div class="flex items-start justify-between">
									<div class="flex-1">
										<h4 class="font-medium text-slate-900 dark:text-slate-100">
											{template.name}
										</h4>
										<p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
											Created: {new Date(
												template.createdAt
											).toLocaleDateString()}
										</p>
										<p
											class="mt-1 font-mono text-xs text-slate-500 dark:text-slate-500"
										>
											{template.folderPath}
										</p>
									</div>
									<FileText size={20} class="text-slate-400" />
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="border-t border-slate-200 p-4 dark:border-slate-700">
				<button
					onclick={handleCancelTemplateSelection}
					class="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
