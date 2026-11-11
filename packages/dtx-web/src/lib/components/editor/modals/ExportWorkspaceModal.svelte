<script lang="ts">
	import {
		workspaceService,
		type Workspace,
		WorkspaceService
	} from '$lib/services/workspaceService';
	import { zipCollisionKey } from '$lib/services/workspacePaths';
	import { SoundLibrary } from '$lib/services/soundLibrary';
	import toastStore from '$lib/toaster';
	import JSZip from 'jszip';

	interface Props {
		show: boolean;
		onClose: () => void;
	}

	let { show, onClose }: Props = $props();

	// Internal state management
	let availableWorkspaces = $state<Workspace[]>(workspaceService.getWorkspaces());
	let includeAudioInExport = $state(true);
	let isExportingWorkspace = $state(false);
	let workspaceToExport = $state<Workspace | null>(null);
	let exportWorkspaceError = $state('');

	// Refresh workspaces when modal opens
	$effect(() => {
		if (show) {
			exportWorkspaceError = '';
			refreshWorkspaces();
		}
	});

	function refreshWorkspaces() {
		availableWorkspaces = workspaceService.getWorkspaces();
	}

	async function exportWorkspace(workspace: Workspace) {
		isExportingWorkspace = true;
		exportWorkspaceError = '';
		workspaceToExport = workspace;

		try {
			const zip = new JSZip();
			// NFC-normalized + lowercased so names that extract onto the same file on
			// case-insensitive / normalizing filesystems (macOS, Windows) are caught.
			// Leading spaces and trailing spaces/dots are also folded because Windows
			// extraction strips them (' kick.wav' and 'kick.wav' land on one file).
			const seenPaths = new Map<string, string>();
			const missingAudio: string[] = [];
			const duplicates: string[] = [];
			const pendingDtx: { name: string; content: string }[] = [];
			const pendingAudio: { name: string; file: File }[] = [];

			const claimName = (path: string): boolean => {
				const key = zipCollisionKey(path);
				const firstPath = seenPaths.get(key);
				if (firstPath !== undefined) {
					duplicates.push(`${path} conflicts with ${firstPath}`);
					return false;
				}
				seenPaths.set(key, path);
				return true;
			};

			// Collect DTX files (from stored content)
			for (const dtxFile of workspace.dtxFiles) {
				if (!claimName(dtxFile.path)) continue;
				pendingDtx.push({ name: dtxFile.path, content: dtxFile.content });
			}

			// Collect audio files (from sound library and session storage) if enabled
			if (includeAudioInExport) {
				for (const audioFile of workspace.audioFiles) {
					if (!claimName(audioFile.path)) continue;

					let file: File;
					if (audioFile.isLarge) {
						// Get large file from session storage
						const largeFile = WorkspaceService.getLargeFile(
							workspace.name,
							audioFile.path
						);
						if (!largeFile) {
							missingAudio.push(
								`${audioFile.path}: only available until the page reloads. Uncheck "Include audio files", or re-import the folder and export the newly imported copy.`
							);
							continue;
						}
						file = largeFile;
					} else {
						// Get small file from sound library by its stored content hash
						if (!audioFile.hash) {
							missingAudio.push(
								`${audioFile.path}: no stored content hash (hashing or sound library storage failed during import, or the folder was imported before hashing was added). Re-import the folder and export the newly imported copy, or uncheck "Include audio files".`
							);
							continue;
						}
						const libraryFile = SoundLibrary.getByHash(audioFile.hash);
						if (!libraryFile) {
							missingAudio.push(
								`${audioFile.path}: no matching audio in the sound library. Re-import the folder and export the newly imported copy (if the sound library is full, free up browser storage first), or uncheck "Include audio files".`
							);
							continue;
						}
						const convertedFile = SoundLibrary.toFile(libraryFile);
						if (!convertedFile) {
							missingAudio.push(
								`${audioFile.path}: stored audio could not be converted back to a file. Re-import the folder and export the newly imported copy, or uncheck "Include audio files".`
							);
							continue;
						}
						file = convertedFile;
					}

					pendingAudio.push({ name: audioFile.path, file });
				}
			}

			if (duplicates.length > 0 || missingAudio.length > 0) {
				const problems: string[] = [];
				if (duplicates.length > 0) {
					problems.push(
						`Duplicate file names would overwrite each other in the ZIP:\n${duplicates
							.map((entry) => `- ${entry}`)
							.join(
								'\n'
							)}\nRename the conflicting files, re-import the folder, and export the newly imported copy, or import the songs separately.`
					);
				}
				if (missingAudio.length > 0) {
					problems.push(
						`Audio files that could not be included:\n${missingAudio
							.map((entry) => `- ${entry}`)
							.join('\n')}`
					);
				}
				throw new Error(
					`Cannot export workspace "${workspace.name}".\n${problems.join('\n')}`
				);
			}

			if (pendingDtx.length + pendingAudio.length === 0) {
				throw new Error('No files found in workspace to export');
			}

			// Only add to the ZIP once the export is known to proceed. Audio bytes
			// are read now rather than letting JSZip defer each File read to
			// generateAsync, which cannot name the file that failed.
			for (const { name, content } of pendingDtx)
				zip.file(name, WorkspaceService.toExportContent(content));

			const audioData: { name: string; data: ArrayBuffer }[] = [];
			const unreadableAudio: string[] = [];
			for (const { name, file } of pendingAudio) {
				try {
					audioData.push({ name, data: await file.arrayBuffer() });
				} catch {
					unreadableAudio.push(name);
				}
			}
			if (unreadableAudio.length > 0) {
				throw new Error(
					`Failed to read audio file${unreadableAudio.length > 1 ? 's' : ''}:\n${unreadableAudio
						.map((name) => `- ${name}`)
						.join(
							'\n'
						)}\nRe-import the folder and export the newly imported copy, or uncheck "Include audio files".`
				);
			}
			for (const { name, data } of audioData) zip.file(name, data);
			const addedDtxCount = pendingDtx.length;
			const addedAudioCount = pendingAudio.length;

			// Generate and download zip
			const zipBlob = await zip.generateAsync({ type: 'blob' });
			const zipFileName = `${workspace.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.zip`;

			// Create download link
			const downloadLink = document.createElement('a');
			downloadLink.href = URL.createObjectURL(zipBlob);
			downloadLink.download = zipFileName;
			document.body.appendChild(downloadLink);
			downloadLink.click();
			document.body.removeChild(downloadLink);

			// Revoke later: some browsers cancel the download if the URL is revoked
			// immediately after click().
			const objectUrl = downloadLink.href;
			setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

			onClose();

			// Show success message
			const message = includeAudioInExport
				? `Workspace "${workspace.name}" exported successfully! (${addedDtxCount} DTX files, ${addedAudioCount} audio files)`
				: `Workspace "${workspace.name}" exported successfully! (${addedDtxCount} DTX files only)`;
			toastStore.success({
				title: message
			});
		} catch (error) {
			console.error('Error exporting workspace:', error);
			exportWorkspaceError =
				error instanceof Error ? error.message : 'Failed to export workspace';
			toastStore.error({
				title: `Failed to export workspace: ${exportWorkspaceError}`
			});
		} finally {
			isExportingWorkspace = false;
			workspaceToExport = null;
		}
	}
</script>

{#if show}
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
		<div
			class="mx-4 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
		>
			<h2 class="mb-4 text-xl font-bold text-gray-800">Export Workspace</h2>

			<p class="mb-4 text-sm text-gray-600">Select a workspace to export as a ZIP file.</p>

			<!-- Audio inclusion option -->
			<div class="mb-4 rounded-lg border border-gray-200 p-3">
				<label class="flex cursor-pointer items-center space-x-2">
					<input
						type="checkbox"
						bind:checked={includeAudioInExport}
						class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
						disabled={isExportingWorkspace}
					/>
					<span class="text-sm font-medium text-gray-700"> Include audio files </span>
				</label>
				<p class="mt-1 text-xs text-gray-500">
					Uncheck to export only DTX files (smaller file size)
				</p>
			</div>

			{#if exportWorkspaceError}
				<div
					role="alert"
					class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-line text-red-700"
				>
					{exportWorkspaceError}
				</div>
			{/if}

			<div class="space-y-2">
				{#each availableWorkspaces as workspace}
					<button
						class="w-full rounded-md border p-3 text-left transition-colors {isExportingWorkspace &&
						workspaceToExport?.name === workspace.name
							? 'cursor-not-allowed border-blue-500 bg-blue-50'
							: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}"
						onclick={() => exportWorkspace(workspace)}
						disabled={isExportingWorkspace}
					>
						<div class="flex items-center justify-between">
							<div>
								<div class="font-medium text-gray-900">{workspace.name}</div>
								<div class="text-sm text-gray-500">
									{workspace.dtxFiles.length} DTX files{includeAudioInExport
										? `, ${workspace.audioFiles.length} audio files`
										: ''}
								</div>
								<div class="text-xs text-gray-400">
									Last modified: {new Date(
										workspace.lastModified
									).toLocaleDateString()}
								</div>
							</div>
							{#if isExportingWorkspace && workspaceToExport?.name === workspace.name}
								<div class="flex items-center gap-2">
									<div
										class="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
									></div>
									<span class="text-sm text-blue-600">Exporting...</span>
								</div>
							{/if}
						</div>
					</button>
				{/each}
			</div>

			<div class="mt-6 flex justify-end space-x-3">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
					onclick={onClose}
					disabled={isExportingWorkspace}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
