<script lang="ts">
	import { X, Music, Trash2 } from '@lucide/svelte/icons';
	import { SoundLibrary } from '$lib/services/soundLibrary';
	import { Modal } from '@dtx/ui-components/components';

	interface LibraryFile {
		hash: string;
		fileName: string;
		size: number;
		fileType: string;
		dateAdded: number;
	}

	interface LibraryStats {
		fileCount: number;
		sizeFormatted: string;
	}

	interface Props {
		show: boolean;
		onClose: () => void;
		onImportResult?: (message: string) => void;
	}

	let { show, onClose, onImportResult }: Props = $props();

	// Internal state management
	let soundLibraryFiles = $state<LibraryFile[]>(SoundLibrary.getAll());
	let libraryStats = $state<LibraryStats>(SoundLibrary.getStats());
	let showRemoveConfirmModal = $state(false);
	let showClearConfirmModal = $state(false);
	let removeFileHash = $state('');

	// Refresh library data
	function refreshSoundLibrary() {
		soundLibraryFiles = SoundLibrary.getAll();
		libraryStats = SoundLibrary.getStats();
	}

	// Add sound files
	function addSoundFiles() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'audio/*,.xa';
		input.multiple = true;
		input.onchange = handleSoundFilesImport;
		input.click();
	}

	// Handle sound file import
	async function handleSoundFilesImport(event: Event) {
		const target = event.target as HTMLInputElement;
		const files = Array.from(target.files || []);
		if (files.length === 0) return;

		try {
			const result = await SoundLibrary.addFiles(files);

			// Show result message
			let message = `Added ${result.added} files`;
			if (result.skipped > 0) {
				message += `, skipped ${result.skipped} duplicates`;
			}
			if (result.errors.length > 0) {
				message += `\n\nErrors:\n${result.errors.join('\n')}`;
			}

			if (onImportResult) {
				onImportResult(message);
			}

			refreshSoundLibrary();
		} catch (error) {
			console.error('Error importing sound files:', error);
			if (onImportResult) {
				onImportResult('Failed to import sound files');
			}
		}
	}

	// Remove sound file (with confirmation)
	function removeSoundFile(hash: string) {
		removeFileHash = hash;
		showRemoveConfirmModal = true;
	}

	function confirmRemoveSoundFile() {
		SoundLibrary.removeFile(removeFileHash);
		refreshSoundLibrary();
		removeFileHash = '';
		showRemoveConfirmModal = false;
	}

	function cancelRemoveSoundFile() {
		showRemoveConfirmModal = false;
		removeFileHash = '';
	}

	// Clear sound library (with confirmation)
	function clearSoundLibrary() {
		showClearConfirmModal = true;
	}

	function confirmClearSoundLibrary() {
		SoundLibrary.clear();
		refreshSoundLibrary();
		showClearConfirmModal = false;
	}

	function cancelClearSoundLibrary() {
		showClearConfirmModal = false;
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString();
	}

	function formatFileSize(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB'];
		let size = bytes;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(1)} ${units[unitIndex]}`;
	}
</script>

{#if show}
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
		<div
			class="mx-4 flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white p-6 shadow-xl"
		>
			<div class="mb-4 flex items-center justify-between border-b border-gray-200 pb-4">
				<h2 class="text-xl font-bold text-gray-800">Sound Files Library</h2>
				<button class="rounded-md text-gray-400 hover:text-gray-600" onclick={onClose}>
					<X class="h-6 w-6" />
				</button>
			</div>

			<!-- Library Stats -->
			<div class="mb-4 rounded-lg bg-gray-50 p-4">
				<div class="flex items-center justify-between">
					<div>
						<span class="text-sm text-gray-600">
							{libraryStats.fileCount} files, {libraryStats.sizeFormatted} total
						</span>
					</div>
					<div class="space-x-2">
						<button
							class="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
							onclick={addSoundFiles}
						>
							Add Files
						</button>
						{#if libraryStats.fileCount > 0}
							<button
								class="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
								onclick={clearSoundLibrary}
							>
								Clear All
							</button>
						{/if}
					</div>
				</div>
			</div>

			<!-- File List -->
			<div class="flex-1 overflow-y-auto">
				{#if soundLibraryFiles.length === 0}
					<div class="py-8 text-center text-gray-500">
						<Music class="mx-auto mb-4 h-12 w-12 text-gray-400" />
						<p class="text-lg font-medium">No sound files in library</p>
						<p class="text-sm">Click "Add Files" to import audio files</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each soundLibraryFiles as file}
							<div
								class="flex items-center justify-between rounded-lg border border-gray-200 p-3 hover:bg-gray-50"
							>
								<div class="min-w-0 flex-1">
									<div class="flex items-center space-x-3">
										<Music class="h-5 w-5 flex-shrink-0 text-blue-500" />
										<div class="min-w-0 flex-1">
											<p class="truncate text-sm font-medium text-gray-900">
												{file.fileName}
											</p>
											<p class="text-xs text-gray-500">
												{formatFileSize(file.size)} • {file.fileType} • Added
												{formatDate(file.dateAdded)}
											</p>
										</div>
									</div>
								</div>
								<button
									class="ml-3 rounded-md text-red-600 hover:text-red-800"
									onclick={() => removeSoundFile(file.hash)}
									title="Remove file"
									aria-label="Remove file"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="mt-4 border-t border-gray-200 pt-4">
				<div class="flex justify-end">
					<button
						class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
						onclick={onClose}
					>
						Close
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Remove File Confirmation Modal -->
<Modal
	bind:open={showRemoveConfirmModal}
	title="Remove File"
	onConfirm={confirmRemoveSoundFile}
	confirmText="Remove"
	confirmVariant="danger"
>
	{#snippet children()}
		<p class="text-gray-700">Are you sure you want to remove this sound file?</p>
	{/snippet}
</Modal>

<!-- Clear Library Confirmation Modal -->
<Modal
	bind:open={showClearConfirmModal}
	title="Clear Library"
	onConfirm={confirmClearSoundLibrary}
	confirmText="Clear All"
	confirmVariant="danger"
>
	{#snippet children()}
		<p class="text-gray-700">
			Are you sure you want to clear the entire sound library? This cannot be undone.
		</p>
	{/snippet}
</Modal>
