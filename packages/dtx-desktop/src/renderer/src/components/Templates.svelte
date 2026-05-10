<script lang="ts">
	import { onMount } from 'svelte';
	import { templateStore, type Template } from '../stores/templateStore';
	import { Plus, Trash2, FolderOpen, Edit2, Save, X, FileText } from '@lucide/svelte';

	let templates = $state<Template[]>([]);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let showCreateForm = $state(false);
	let editingTemplateId = $state<string | null>(null);

	// Create form state
	let newTemplateName = $state('');
	let selectedTemplateFolder = $state('');

	// Edit form state
	let editTemplateName = $state('');

	// Subscribe to template store
	const unsubscribe = templateStore.subscribe((state) => {
		templates = state.templates;
		isLoading = state.isLoading;
		error = state.error;
	});

	const handleCreateTemplate = () => {
		showCreateForm = true;
		newTemplateName = '';
		selectedTemplateFolder = '';
		templateStore.clearError();
	};

	const handleSelectTemplateFolder = async () => {
		try {
			const result = await window.electron.ipcRenderer.invoke('select-folder');
			if (!result.canceled && result.filePaths.length > 0) {
				selectedTemplateFolder = result.filePaths[0];
			}
		} catch (err) {
			console.error('Failed to select folder:', err);
			templateStore.setError('Failed to select folder');
		}
	};

	const handleSaveTemplate = async () => {
		if (!newTemplateName.trim()) {
			templateStore.setError('Please enter a template name');
			return;
		}

		if (!selectedTemplateFolder) {
			templateStore.setError('Please select a template folder');
			return;
		}

		// Check if template name already exists
		if (templates.some((t) => t.name.toLowerCase() === newTemplateName.trim().toLowerCase())) {
			templateStore.setError('A template with this name already exists');
			return;
		}

		try {
			// Verify that the selected folder exists
			const folderResult = await window.electron.ipcRenderer.invoke(
				'path-exists',
				selectedTemplateFolder
			);
			if (!folderResult.exists) {
				templateStore.setError('Selected folder does not exist');
				return;
			}

			templateStore.addTemplate(newTemplateName, selectedTemplateFolder);
			showCreateForm = false;
			newTemplateName = '';
			selectedTemplateFolder = '';
		} catch (err) {
			console.error('Failed to create template:', err);
			templateStore.setError('Failed to create template');
		}
	};

	const handleCancelCreate = () => {
		showCreateForm = false;
		newTemplateName = '';
		selectedTemplateFolder = '';
		templateStore.clearError();
	};

	const handleEditTemplate = (template: Template) => {
		editingTemplateId = template.id;
		editTemplateName = template.name;
		templateStore.clearError();
	};

	const handleSaveEdit = (templateId: string) => {
		if (!editTemplateName.trim()) {
			templateStore.setError('Please enter a template name');
			return;
		}

		// Check if template name already exists (excluding current template)
		if (
			templates.some(
				(t) =>
					t.id !== templateId &&
					t.name.toLowerCase() === editTemplateName.trim().toLowerCase()
			)
		) {
			templateStore.setError('A template with this name already exists');
			return;
		}

		templateStore.updateTemplate(templateId, { name: editTemplateName });
		editingTemplateId = null;
		editTemplateName = '';
	};

	const handleCancelEdit = () => {
		editingTemplateId = null;
		editTemplateName = '';
		templateStore.clearError();
	};

	const handleDeleteTemplate = (templateId: string) => {
		if (
			confirm('Are you sure you want to delete this template? This action cannot be undone.')
		) {
			templateStore.removeTemplate(templateId);
		}
	};

	const handleOpenTemplateFolder = async (folderPath: string) => {
		try {
			await window.electron.ipcRenderer.invoke('open-folder-in-explorer', folderPath);
		} catch (err) {
			console.error('Failed to open folder:', err);
			templateStore.setError('Failed to open folder');
		}
	};

	onMount(() => {
		return unsubscribe;
	});
</script>

<div class="flex h-full flex-col overflow-hidden bg-white dark:bg-slate-800">
	<!-- Header -->
	<div
		class="flex items-center justify-between gap-2 border-b border-slate-200 p-6 pb-4 dark:border-slate-700"
	>
		<div class="flex items-center gap-2">
			<FileText size={20} class="text-slate-500" />
			<h2 class="text-xl font-semibold">Song Templates</h2>
		</div>
		<div class="flex gap-2">
			<button
				class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-green-600 hover:to-emerald-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
				onclick={handleCreateTemplate}
				tabindex="0"
				aria-label="Create new template"
			>
				<Plus size={16} />
				New Template
			</button>
		</div>
	</div>

	<!-- Content Area -->
	<div class="flex-1 overflow-auto p-6">
		{#if error}
			<div
				class="mb-4 rounded-lg bg-red-50 p-4 text-red-800 dark:bg-red-900/20 dark:text-red-300"
			>
				<p>{error}</p>
			</div>
		{/if}

		{#if showCreateForm}
			<!-- Create Template Form -->
			<div
				class="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-800/50"
			>
				<h3 class="mb-4 text-lg font-medium">Create New Template</h3>

				<div class="space-y-4">
					<div>
						<label
							for="template-name"
							class="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
						>
							Template Name
						</label>
						<input
							id="template-name"
							bind:value={newTemplateName}
							type="text"
							placeholder="Enter template name..."
							class="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-blue-400"
						/>
					</div>

					<div>
						<label
							for="template-folder"
							class="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
						>
							Template Folder
						</label>
						<div class="flex gap-2">
							<input
								id="template-folder"
								bind:value={selectedTemplateFolder}
								type="text"
								placeholder="Select a folder..."
								readonly
								class="flex-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-600 dark:text-slate-100"
							/>
							<button
								onclick={handleSelectTemplateFolder}
								class="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
							>
								<FolderOpen size={16} />
								Browse
							</button>
						</div>
					</div>

					<div class="flex gap-2">
						<button
							onclick={handleSaveTemplate}
							class="flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600"
						>
							<Save size={16} />
							Save Template
						</button>
						<button
							onclick={handleCancelCreate}
							class="flex items-center gap-2 rounded-lg bg-slate-500 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
						>
							<X size={16} />
							Cancel
						</button>
					</div>
				</div>
			</div>
		{/if}

		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<div class="text-slate-600 dark:text-slate-400">Loading templates...</div>
			</div>
		{:else if templates.length === 0}
			<div class="flex flex-col items-center py-8">
				<div
					class="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30"
				>
					<FileText size={40} class="text-blue-500 dark:text-blue-300" />
				</div>
				<p class="mb-6 text-center text-slate-600 dark:text-slate-400">
					No templates found. Create your first song template to get started.
				</p>
				{#if !showCreateForm}
					<button
						class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-2.5 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-blue-600 hover:to-indigo-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
						onclick={handleCreateTemplate}
						tabindex="0"
						aria-label="Create your first template"
					>
						<Plus size={20} />
						Create First Template
					</button>
				{/if}
			</div>
		{:else}
			<!-- Templates List -->
			<div class="space-y-4">
				{#each templates as template (template.id)}
					<div
						class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
					>
						{#if editingTemplateId === template.id}
							<!-- Edit Mode -->
							<div class="flex items-center gap-2">
								<input
									bind:value={editTemplateName}
									type="text"
									class="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-blue-400"
								/>
								<button
									onclick={() => handleSaveEdit(template.id)}
									class="flex items-center gap-1 rounded-lg bg-green-500 px-3 py-2 text-sm font-medium text-white hover:bg-green-600"
								>
									<Save size={14} />
									Save
								</button>
								<button
									onclick={handleCancelEdit}
									class="flex items-center gap-1 rounded-lg bg-slate-500 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600"
								>
									<X size={14} />
									Cancel
								</button>
							</div>
						{:else}
							<!-- View Mode -->
							<div class="flex items-center justify-between">
								<div class="flex-1">
									<h3
										class="text-lg font-medium text-slate-900 dark:text-slate-100"
									>
										{template.name}
									</h3>
									<p class="text-sm text-slate-600 dark:text-slate-400">
										Created: {new Date(template.createdAt).toLocaleDateString()}
									</p>
									<p class="font-mono text-xs text-slate-500 dark:text-slate-500">
										{template.folderPath}
									</p>
								</div>
								<div class="flex gap-2">
									<button
										onclick={() =>
											handleOpenTemplateFolder(template.folderPath)}
										class="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600"
										title="Open folder"
									>
										<FolderOpen size={14} />
									</button>
									<button
										onclick={() => handleEditTemplate(template)}
										class="flex items-center gap-1 rounded-lg bg-slate-500 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600"
										title="Edit template"
									>
										<Edit2 size={14} />
									</button>
									<button
										onclick={() => handleDeleteTemplate(template.id)}
										class="flex items-center gap-1 rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white hover:bg-red-600"
										title="Delete template"
									>
										<Trash2 size={14} />
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
