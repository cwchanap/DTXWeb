<script lang="ts">
	import { onMount } from 'svelte';
	import { templateStore, type Template } from '../stores/templateStore';
	import { Plus, Trash2, FolderOpen, Edit2, Save, X, FileText } from '@lucide/svelte';
	import { desktopHost } from '../services/desktopHost';

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
			const result = await desktopHost.selectFolder();
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
			const folderResult = await desktopHost.pathExists(selectedTemplateFolder);
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
			await desktopHost.openFolder(folderPath);
		} catch (err) {
			console.error('Failed to open folder:', err);
			templateStore.setError('Failed to open folder');
		}
	};

	onMount(() => {
		return unsubscribe;
	});
</script>

<div class="bg-base flex h-full flex-col overflow-hidden">
	<!-- Header -->
	<div
		class="border-hairline bg-surface-1 flex items-center justify-between gap-2 border-b p-6 pb-4"
	>
		<div class="flex items-center gap-2">
			<FileText size={20} class="text-dim" />
			<h2 class="font-display text-hi text-xl font-semibold">Song Templates</h2>
		</div>
		<div class="flex gap-2">
			<button
				class="bg-magenta focus-visible:outline-cyan flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[#16001a] shadow-md transition duration-150 ease-in-out hover:opacity-90 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
				style="box-shadow:0 0 22px -6px var(--color-magenta)"
				onclick={handleCreateTemplate}
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
			<div class="border-red/40 bg-red/10 text-red mb-4 rounded-lg p-4">
				<p>{error}</p>
			</div>
		{/if}

		{#if showCreateForm}
			<!-- Create Template Form -->
			<div class="border-hairline bg-surface-2 mb-6 rounded-lg border p-6">
				<h3 class="font-display text-hi mb-4 text-lg font-medium">Create New Template</h3>

				<div class="space-y-4">
					<div>
						<label
							for="template-name"
							class="text-base-text mb-2 block text-sm font-medium"
						>
							Template Name
						</label>
						<input
							id="template-name"
							bind:value={newTemplateName}
							type="text"
							placeholder="Enter template name..."
							class="border-hairline bg-surface-1 text-hi focus:border-cyan focus:ring-cyan/20 w-full rounded-lg border px-3 py-2 focus:ring-2"
						/>
					</div>

					<div>
						<label
							for="template-folder"
							class="text-base-text mb-2 block text-sm font-medium"
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
								class="border-hairline bg-surface-2 text-hi flex-1 rounded-lg border px-3 py-2 font-mono"
							/>
							<button
								onclick={handleSelectTemplateFolder}
								class="bg-surface-2 text-cyan flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
							>
								<FolderOpen size={16} />
								Browse
							</button>
						</div>
					</div>

					<div class="flex gap-2">
						<button
							onclick={handleSaveTemplate}
							class="border-green/40 bg-green/10 text-green flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
						>
							<Save size={16} />
							Save Template
						</button>
						<button
							onclick={handleCancelCreate}
							class="bg-surface-2 text-dim flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
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
				<div class="text-dim">Loading templates...</div>
			</div>
		{:else if templates.length === 0}
			<div class="flex flex-col items-center py-8">
				<div
					class="bg-surface-2 mb-4 flex h-20 w-20 items-center justify-center rounded-full"
				>
					<FileText size={40} class="text-cyan" />
				</div>
				<p class="text-dim mb-6 text-center">
					No templates found. Create your first song template to get started.
				</p>
				{#if !showCreateForm}
					<button
						class="bg-magenta focus-visible:outline-cyan flex items-center gap-2 rounded-lg px-6 py-2.5 font-medium text-[#16001a] shadow-md transition duration-150 ease-in-out hover:opacity-90 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
						style="box-shadow:0 0 22px -6px var(--color-magenta)"
						onclick={handleCreateTemplate}
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
					<div class="border-hairline bg-surface-1 rounded-lg border p-4">
						{#if editingTemplateId === template.id}
							<!-- Edit Mode -->
							<div class="flex items-center gap-2">
								<input
									bind:value={editTemplateName}
									type="text"
									class="border-hairline bg-surface-2 text-hi focus:border-cyan focus:ring-cyan/20 flex-1 rounded-lg border px-3 py-2 focus:ring-2"
								/>
								<button
									onclick={() => handleSaveEdit(template.id)}
									class="border-green/40 bg-green/10 text-green flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90"
								>
									<Save size={14} />
									Save
								</button>
								<button
									onclick={handleCancelEdit}
									class="bg-surface-2 text-dim flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90"
								>
									<X size={14} />
									Cancel
								</button>
							</div>
						{:else}
							<!-- View Mode -->
							<div class="flex items-center justify-between">
								<div class="flex-1">
									<h3 class="text-hi text-lg font-medium">
										{template.name}
									</h3>
									<p class="text-dim text-sm">
										Created: {new Date(template.createdAt).toLocaleDateString()}
									</p>
									<p class="text-faint font-mono text-xs">
										{template.folderPath}
									</p>
								</div>
								<div class="flex gap-2">
									<button
										onclick={() =>
											handleOpenTemplateFolder(template.folderPath)}
										class="bg-surface-2 text-cyan flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90"
										title="Open folder"
									>
										<FolderOpen size={14} />
									</button>
									<button
										onclick={() => handleEditTemplate(template)}
										class="bg-surface-2 text-dim flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90"
										title="Edit template"
									>
										<Edit2 size={14} />
									</button>
									<button
										onclick={() => handleDeleteTemplate(template.id)}
										class="border-red/40 bg-red/10 text-red flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90"
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
