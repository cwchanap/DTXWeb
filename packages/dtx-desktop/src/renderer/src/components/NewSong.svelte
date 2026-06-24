<script lang="ts">
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
	import { templateStore, type Template } from '../stores/templateStore';
	import { Folder, ArrowLeft, Music, FileText, X } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { desktopHost } from '../services/desktopHost';

	let songName = $state('');
	let folderName = $state('');
	let selectedPath = $state('');
	let useSameNameForFolder = $state(true);
	let isCreating = $state(false);
	let error = $state('');
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
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
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
				const folderResult = await desktopHost.pathExists(
					selectedPath,
					selectedPath,
					sanitizedFolderName
				);

				// Check again if this request is still current after the async call
				if (checkId !== currentCheckId) {
					return; // Request has been superseded, ignore result
				}

				if (folderResult.exists) {
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
		sanitized = sanitized.replace(/[\\/]/g, ''); // Remove path separators

		// Remove or replace invalid filename characters (Windows + Unix)
		// Invalid characters: < > : " | ? * and control characters (0-31, 127)
		sanitized = sanitized.replace(/[<>:"|?*]/g, '');
		sanitized = sanitized
			.split('')
			.filter((char) => {
				const code = char.charCodeAt(0);
				return code >= 32 && code !== 127;
			})
			.join('');

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
		// The default selectedPath is set to the current workspace path.
		if (workspaceState.path) {
			selectedPath = workspaceState.path;
		}
		return () => {
			unsubscribeTemplate();
		};
	});

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
		const folderResult = await desktopHost.pathExists(
			selectedPath,
			selectedPath,
			sanitizedFolderName
		);
		if (folderResult.exists) {
			error = `A folder named "${sanitizedFolderName}" already exists in the selected location`;
			return;
		}

		isCreating = true;
		error = '';

		try {
			// Create the song using the consolidated IPC call
			const result = await desktopHost.createSong({
				selectedPath,
				sanitizedFolderName,
				sanitizedSongName,
				templateFolderPath: selectedTemplate?.folderPath || null
			});

			console.log('Song created successfully:', result);

			// Refresh workspace tree to show new folder
			if (workspaceState.path) {
				const updatedTree = await desktopHost.loadTreeStructure<TreeNode[]>(
					workspaceState.path,
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
			const result = await desktopHost.selectFolder();
			if (result && !result.canceled && result.filePaths.length > 0) {
				const newPath = result.filePaths[0];
				selectedPath = newPath;
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

	// Dismiss the template modal when the backdrop itself (not its children) is clicked.
	function handleTemplateBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			handleCancelTemplateSelection();
		}
	}

	// Dismiss the template modal on Escape. Key events bubble from the panel to
	// the backdrop, which carries the handler.
	function handleTemplateEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleCancelTemplateSelection();
		}
	}
</script>

<div class="bg-base flex h-full flex-col overflow-hidden">
	<!-- Header -->
	<div
		class="border-hairline bg-surface-1 flex items-center justify-between gap-2 border-b p-6 pb-4"
	>
		<div class="flex items-center gap-2">
			<button
				onclick={goBack}
				class="bg-surface-2 text-base-text hover:text-hi flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:opacity-90"
			>
				<ArrowLeft size={16} />
				Back
			</button>
		</div>
		<div class="flex items-center gap-2">
			<Music size={20} class="text-dim" />
			<h2 class="font-display text-hi text-xl font-semibold">Create New Song</h2>
		</div>
		<div class="w-20"></div>
		<!-- Spacer for centering -->
	</div>

	<!-- Main Content -->
	<div class="flex flex-1 items-center justify-center p-6">
		<div class="border-hairline bg-surface-1 w-full max-w-md rounded-lg border p-6 shadow-lg">
			<div class="mb-6 text-center">
				<h3 class="font-display text-hi text-lg font-semibold">New Song Folder</h3>
			</div>

			{#if error}
				<div class="border-red/40 bg-red/10 text-red mb-4 rounded-lg border p-3 text-sm">
					{error}
				</div>
			{/if}

			{#if folderExistsWarning}
				<div
					class="border-amber/40 bg-amber/10 text-amber mb-4 rounded-lg border p-3 text-sm"
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
					<label for="songName" class="text-base-text mb-2 block text-sm font-medium">
						Song Name
					</label>
					<input
						id="songName"
						type="text"
						bind:value={songName}
						placeholder="Enter song name..."
						required
						class="border-hairline bg-surface-2 text-hi placeholder-faint focus:border-cyan w-full rounded-lg border px-3 py-2 focus:ring-1 focus:outline-none"
					/>
				</div>

				<!-- Use Same Name Checkbox -->
				<div class="flex items-center gap-2">
					<input
						id="useSameName"
						type="checkbox"
						bind:checked={useSameNameForFolder}
						class="border-hairline text-cyan focus:ring-cyan rounded"
					/>
					<label for="useSameName" class="text-base-text text-sm">
						Use same name for folder
					</label>
				</div>

				<!-- Folder Name Input (only show when checkbox is unchecked) -->
				{#if !useSameNameForFolder}
					<div>
						<label
							for="folderName"
							class="text-base-text mb-2 block text-sm font-medium"
						>
							Folder Name
						</label>
						<input
							id="folderName"
							type="text"
							bind:value={folderName}
							placeholder="Enter folder name..."
							required
							class="border-hairline bg-surface-2 text-hi placeholder-faint focus:border-cyan w-full rounded-lg border px-3 py-2 focus:ring-1 focus:outline-none"
						/>
					</div>
				{/if}

				<!-- Template Import Section -->
				<div>
					<label for="template" class="text-base-text mb-2 block text-sm font-medium">
						Template (Optional)
					</label>

					{#if selectedTemplate}
						<!-- Show selected template -->
						<div class="border-green/40 bg-green/10 rounded-lg border p-3">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<FileText size={16} class="text-green" />
									<span class="text-green text-sm font-medium">
										{selectedTemplate.name}
									</span>
								</div>
								<button
									type="button"
									onclick={handleClearTemplate}
									class="border-red/40 bg-red/10 text-red flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium hover:opacity-90"
									title="Remove template"
								>
									<X size={12} />
								</button>
							</div>
							<p class="text-green mt-1 text-xs">
								Template files will be copied to the new song folder
							</p>
						</div>
					{:else}
						<!-- Import template button -->
						<button
							id="template"
							type="button"
							onclick={handleImportTemplate}
							class="border-hairline bg-surface-2 text-dim hover:border-cyan hover:text-cyan flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors"
						>
							<FileText size={16} />
							Import Template
						</button>
					{/if}
				</div>

				<!-- Folder Path Selection -->
				<div>
					<button
						type="button"
						onclick={selectCustomPath}
						class="border-hairline bg-surface-2 text-dim hover:border-cyan hover:text-cyan flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors"
					>
						<Folder size={14} />
						Choose different folder...
					</button>
				</div>

				<!-- Selected Path Display -->
				{#if selectedPath}
					<div class="bg-surface-2 mt-2 rounded-lg p-3">
						<p class="text-dim text-xs">Full path:</p>
						<p class="text-hi font-mono text-sm">
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
						class="border-hairline bg-surface-2 text-base-text hover:text-hi flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:opacity-90"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isCreating ||
							!songName.trim() ||
							!selectedPath ||
							!!folderExistsWarning}
						class="bg-magenta flex-1 rounded-lg px-4 py-2 text-sm font-medium text-[#16001a] transition-colors hover:opacity-90 focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						style="box-shadow:0 0 22px -6px var(--color-magenta)"
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
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		role="dialog"
		aria-modal="true"
		aria-labelledby="template-modal-title"
		tabindex="-1"
		onclick={handleTemplateBackdropClick}
		onkeydown={handleTemplateEscape}
	>
		<div class="bg-surface-1 max-h-[80vh] w-full max-w-md overflow-hidden rounded-lg shadow-xl">
			<!-- Modal Header -->
			<div class="border-hairline border-b p-4">
				<div class="flex items-center justify-between">
					<h3
						id="template-modal-title"
						class="font-display text-hi text-lg font-semibold"
					>
						Select Template
					</h3>
					<button
						onclick={handleCancelTemplateSelection}
						class="text-faint hover:bg-surface-2 hover:text-base-text rounded-lg p-1"
					>
						<X size={20} />
					</button>
				</div>
			</div>

			<!-- Modal Content -->
			<div class="max-h-[60vh] overflow-y-auto p-4">
				{#if templates.length === 0}
					<div class="flex flex-col items-center py-8 text-center">
						<FileText size={48} class="text-faint mb-3" />
						<p class="text-dim">
							No templates available. Create a template first in the Templates
							section.
						</p>
					</div>
				{:else}
					<div class="space-y-3">
						{#each templates as template (template.id)}
							<button
								onclick={() => handleSelectTemplate(template)}
								class="border-hairline bg-surface-2 hover:border-cyan w-full rounded-lg border p-3 text-left transition-colors hover:opacity-90"
							>
								<div class="flex items-start justify-between">
									<div class="flex-1">
										<h4 class="text-hi font-medium">
											{template.name}
										</h4>
										<p class="text-dim mt-1 text-sm">
											Created: {new Date(
												template.createdAt
											).toLocaleDateString()}
										</p>
										<p class="text-faint mt-1 font-mono text-xs">
											{template.folderPath}
										</p>
									</div>
									<FileText size={20} class="text-faint" />
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="border-hairline border-t p-4">
				<button
					onclick={handleCancelTemplateSelection}
					class="border-hairline bg-surface-2 text-base-text hover:text-hi w-full rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:opacity-90"
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
