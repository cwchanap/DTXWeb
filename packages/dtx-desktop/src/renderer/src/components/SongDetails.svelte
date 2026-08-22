<script lang="ts">
	import { Music, X, Link, Search, Upload } from '@lucide/svelte';
	import { _ } from 'svelte-i18n';
	import { workspaceStore, type TreeNode } from '$lib/stores/workspaceStore';
	import { settingsStore } from '$lib/stores/settingsStore';
	import { editorMappingStore } from '$lib/stores/editorMappingStore';
	import { authStore } from '$lib/stores/authStore';
	import { UploadedAssetFiles, ChartDetail } from '@dtx/common/components';
	import { isValidDtxFile } from '@dtx/common';
	import type { SimfileModel, SimfileDtxFile } from '@dtx/common';
	import { onMount } from 'svelte';
	import CloudSongAutocomplete from '$lib/components/CloudSongAutocomplete.svelte';
	import { simFileService } from '$lib/services/simFileService';
	import { desktopHost } from '$lib/services/desktopHost';
	import type {
		CreateSimfileRecordInput,
		UpdateSimfileRecordInput
	} from '$lib/lib/generated/native-api-contracts';
	import { googleDriveService, type SongSaveOutcome } from '$lib/services/googleDriveService';
	import {
		getActiveGoogleDriveOperationForSimfile,
		googleDriveStore
	} from '$lib/stores/googleDriveStore';
	import GoogleDriveUploadStatus from '$lib/components/GoogleDriveUploadStatus.svelte';
	import {
		getPrimaryOutcomeKey,
		getLocalSongActionKey,
		withoutMapKey,
		beginLocalSongAction as beginLocalSongActionInMap,
		finishLocalSongAction as finishLocalSongActionInMap,
		isSelectionCurrent,
		computeDriveFieldMerge,
		getCachedDisplayId,
		shouldSkipAutoPopulate,
		type LocalSongAction
	} from '$lib/services/songDetailsActions';

	interface Props {
		song: TreeNode;
	}

	type ListedFile = {
		fileName: string;
		key: string;
		lastModified: number;
	};

	type ListFilesResponse = {
		files: ListedFile[];
		error?: string;
	};

	type CloudSong = {
		id: string;
		title: string;
		artist: string;
		bpm?: number;
		isPublished: boolean;
	};

	type ExportSongResult = {
		success: boolean;
		zipPath?: string;
		filesCount?: number;
		error?: string;
	};

	type KeyedDriveOutcome = {
		simfileId: string;
		result: SongSaveOutcome['driveUpload'];
		source: 'automatic' | 'manual';
	};

	type PrimarySaveSuccess = {
		simfileId: string;
		messageKey: 'googleDrive.songDetails.draftSaved' | 'googleDrive.songDetails.published';
	};

	type TimedPrimaryError = {
		id: number;
		message: string;
	};

	type AssetFile = {
		fileName: string;
		size: number;
		lastModified: string;
		key: string;
	};

	type LoadAssetFilesResult = {
		success: boolean;
		data?: AssetFile[];
		error?: string;
	};

	let { song }: Props = $props();

	// State for local files
	let localFiles = $state<File[]>([]);
	let isLoadingFiles = $state(false);
	let fileLoadError = $state<string | null>(null);

	const handleClose = () => {
		workspaceStore.closeSongDetails();
	};

	const handleOpenEditor = () => {
		// Navigate to editor page for this song
		let simFileId: string;

		if (song.linkedSimFileId) {
			// Use the linked simFileId if available
			simFileId = song.linkedSimFileId;
		} else {
			// For unlinked songs, use the folder name as simFileId
			simFileId = song.name || 'new-song';
		}

		// Store the mapping of simFileId to song folder path and song name
		if (song.path) {
			const songName = song.songTitle || song.name || 'Unknown Song';
			editorMappingStore.setMappingWithMetadata(simFileId, song.path, songName);
		}

		const editorPath = `editor/${simFileId}`;

		// Close the song details first
		workspaceStore.closeSongDetails();

		// Use the router to navigate to the editor
		window.location.hash = `#${editorPath}`;

		// Manually trigger hashchange event to ensure route handler picks it up
		window.dispatchEvent(new HashChangeEvent('hashchange'));
	};

	import { toBlobPart, type FileContent } from '$lib/utils/fileUtils';

	// Helper function to create File object with custom properties

	const createFileObject = (content: FileContent, fileInfo: ListedFile) => {
		const file = new File([toBlobPart(content)], fileInfo.fileName, {
			lastModified: new Date(fileInfo.lastModified).getTime()
		});
		// Add the file path as a custom property for desktop uploads
		(file as unknown as { filePath: string }).filePath = fileInfo.key;
		return file;
	};

	// Load local files from the song folder
	const loadLocalFiles = async () => {
		if (!song.path) return;

		isLoadingFiles = true;
		fileLoadError = null;

		try {
			const result = await desktopHost.listFiles<ListFilesResponse>(song.path);

			if (result.error) {
				throw new Error(result.error);
			}

			// Convert file info to File objects for compatibility with UploadedAssetFiles
			// Only include files with valid DTX-related extensions
			const files = await Promise.all(
				result.files
					.filter((fileInfo: ListedFile) => isValidDtxFile(fileInfo.fileName))
					.map(async (fileInfo: ListedFile) => {
						try {
							// Read file content as buffer
							const response = await desktopHost.readFile(fileInfo.key);

							// Destructure the response to get error and content
							const { error, content } = response;

							// Check if there was an error reading the file
							if (error) {
								console.warn(`Could not read file ${fileInfo.fileName}:`, error);
								// Create empty File object as fallback
								return createFileObject('', fileInfo);
							}

							// Create File object using the content property
							return createFileObject(content, fileInfo);
						} catch (error) {
							console.warn(`Could not read file ${fileInfo.fileName}:`, error);
							// Create empty File object as fallback
							return createFileObject('', fileInfo);
						}
					})
			);

			localFiles = files;
		} catch (error) {
			console.error('Error loading local files:', error);
			fileLoadError = error instanceof Error ? error.message : 'Failed to load files';
		} finally {
			isLoadingFiles = false;
		}
	};

	// Load files when component mounts or song changes
	onMount(() => {
		loadLocalFiles();

		// Return cleanup function
		return () => {
			unsubscribeSettings();
		};
	});

	// Reload files when song changes
	$effect(() => {
		if (song.path) {
			loadLocalFiles();
		}
	});

	// State for parsed local DTX data
	let parsedLocalData = $state<{
		bpm?: number;
		artist?: string;
		levels?: { label: string; level: number }[];
	}>({});

	// State for upload process
	let uploadErrorsBySong = $state<Map<string, TimedPrimaryError>>(new Map());
	let uploadWarningsBySong = $state<Map<string, string[]>>(new Map());
	let displayIdAutoPopulateError = $state<string | null>(null);
	let autoPopulatedDisplayId = $state<{ path: string; value: number } | null>(null);
	const autoPopulatedForPaths = new Map<string, number>();
	const autoPopulateInFlightPaths = new Set<string>();

	// Reactive form values that mirror the ChartDetail component's state
	let displayId = $state(0);
	let publishDate = $state('');
	let downloadUrl = $state('');
	let videoPreviewUrl = $state('');
	let isPublished = $state(false);

	// Track which action is being performed
	let currentUploadAction: 'draft' | 'publish' | null = $state(null);

	// Autocomplete popup state
	let showAutocomplete = $state(false);
	let autocompletePosition = $state({ top: 0, left: 0, width: 0 });

	// Linking state
	let isLinking = $state(false);
	let linkingError = $state<string | null>(null);
	let linkingSuccess = $state(false);

	// Update state
	let updateErrorsBySong = $state<Map<string, TimedPrimaryError>>(new Map());

	// Export state
	let isExporting = $state(false);
	let exportError = $state<string | null>(null);
	let exportSuccess = $state(false);
	let exportedFilePath = $state<string | null>(null);
	let localSongActions = $state<Map<string, LocalSongAction>>(new Map());
	let driveOutcome = $state<KeyedDriveOutcome | undefined>();
	let primarySaveSuccess = $state<PrimarySaveSuccess | undefined>();
	let selectedSongPath = $state('');
	let selectionGeneration = 0;
	let primaryOutcomeSequence = 0;
	const currentSimfileId = $derived(song.linkedSimFileId || undefined);
	const currentPrimaryOutcomeKey = $derived(
		getPrimaryOutcomeKey(song, $workspaceStore.path || '')
	);
	const uploadError = $derived(uploadErrorsBySong.get(currentPrimaryOutcomeKey)?.message ?? null);
	const uploadWarnings = $derived(uploadWarningsBySong.get(currentPrimaryOutcomeKey) ?? []);
	const updateError = $derived(updateErrorsBySong.get(currentPrimaryOutcomeKey)?.message ?? null);
	const currentLocalSongActionKey = $derived(
		getLocalSongActionKey(song, $workspaceStore.path || '')
	);
	const currentLocalSongAction = $derived(localSongActions.get(currentLocalSongActionKey));
	const isUploading = $derived(currentLocalSongAction?.kind === 'create');
	const isUpdating = $derived(currentLocalSongAction?.kind === 'update');
	const isDriveActionInProgress = $derived(currentLocalSongAction?.kind === 'drive');
	const currentDriveOperation = $derived(
		getActiveGoogleDriveOperationForSimfile($googleDriveStore, currentSimfileId)
	);
	const currentDriveOutcome = $derived(
		driveOutcome?.simfileId === currentSimfileId ? driveOutcome : undefined
	);
	const currentPrimarySaveSuccess = $derived(
		primarySaveSuccess?.simfileId === currentSimfileId ? primarySaveSuccess : undefined
	);

	const beginLocalSongAction = (
		key: string,
		kind: LocalSongAction['kind']
	): LocalSongAction | undefined => {
		const result = beginLocalSongActionInMap(localSongActions, key, kind);
		if (!result) return undefined;
		localSongActions = result.actions;
		return result.action;
	};

	const finishLocalSongAction = (key: string, action: LocalSongAction): void => {
		localSongActions = finishLocalSongActionInMap(localSongActions, key, action);
	};

	const mergeSuccessfulDriveFields = (
		targetSong: TreeNode,
		targetPath: string,
		simfileId: string,
		outcome: SongSaveOutcome['driveUpload']
	): void => {
		const fields = computeDriveFieldMerge(outcome);
		if (!fields) return;

		if (targetSong.linkedSimFile && targetSong.linkedSimFileId === simfileId) {
			targetSong.linkedSimFile = {
				...targetSong.linkedSimFile,
				...fields
			};
		}
		workspaceStore.mergeGoogleDriveFields(targetPath, simfileId, fields);
	};

	// Settings store subscription for export directory
	let currentSettings = $state({ exportDirectory: '~/Downloads' });
	const unsubscribeSettings = settingsStore.subscribe((settings) => {
		currentSettings = settings;
	});

	// Get all linked song IDs from workspace to exclude from search
	const getLinkedSongIds = $derived(() => {
		const workspaceState = $workspaceStore;
		const linkedIds: string[] = [];

		const collectLinkedIds = (nodes: typeof workspaceState.treeStructure) => {
			for (const node of nodes) {
				if (node.linkedSimFileId) {
					linkedIds.push(node.linkedSimFileId);
				}
				if (node.children.length > 0) {
					collectLinkedIds(node.children);
				}
			}
		};

		collectLinkedIds(workspaceState.treeStructure);
		return linkedIds;
	});

	// Custom asset file loader for desktop
	const loadAssetFilesForDesktop = async (simfileId: string): Promise<AssetFile[]> => {
		// For unlinked songs (no simfileId), return empty array - we only show local files
		if (!simfileId || simfileId === '' || simfileId === '0') {
			return [];
		}

		// For linked songs, fetch actual cloud files via IPC
		try {
			const result = await desktopHost.loadAssetFiles<LoadAssetFilesResult>(simfileId);
			if (!result.success) {
				console.error('Error loading cloud asset files:', result.error);
				return [];
			}
			return result.data ?? [];
		} catch (error) {
			console.error('Error loading cloud asset files:', error);
			return [];
		}
	};

	// Handle upload for unlinked songs
	const handleUploadSong = async (event: CustomEvent) => {
		// Update reactive variables with current form values from ChartDetail
		if (event.detail) {
			displayId = event.detail.displayId !== undefined ? event.detail.displayId : displayId;
			publishDate =
				event.detail.publishDate !== undefined ? event.detail.publishDate : publishDate;
			downloadUrl =
				event.detail.downloadUrl !== undefined ? event.detail.downloadUrl : downloadUrl;
			videoPreviewUrl =
				event.detail.videoPreviewUrl !== undefined
					? event.detail.videoPreviewUrl
					: videoPreviewUrl;
		}

		// Override isPublished based on the current action
		if (currentUploadAction) {
			event.detail.isPublished = currentUploadAction === 'publish';
		}

		const isPublished = event.detail.isPublished || false;
		await uploadSong(event, isPublished);

		// Reset action after upload
		currentUploadAction = null;
	};

	// Function to trigger save with specific isPublished value
	const triggerSave = (isPublished: boolean) => {
		// Set the current action
		currentUploadAction = isPublished ? 'publish' : 'draft';

		// Use reactive variables directly (no DOM access needed)
		const currentFormValues = {
			displayId: displayId,
			publishDate: publishDate,
			downloadUrl: downloadUrl,
			videoPreviewUrl: videoPreviewUrl,
			isPublished: isPublished
		};

		// Create event with the current form values
		const event = new CustomEvent('onSave', {
			detail: currentFormValues
		});
		handleUploadSong(event);
	};

	// Common upload function
	const uploadSong = async (event: CustomEvent, isPublished: boolean) => {
		if (!song.containsDtxFiles || song.linkedSimFile) {
			return;
		}

		const targetSong = song;
		const targetPath = song.path;
		const workspacePath = $workspaceStore.path || '';
		const localActionKey = getLocalSongActionKey(targetSong, workspacePath);
		const primaryOutcomeKey = getPrimaryOutcomeKey(targetSong, workspacePath);
		const localAction = beginLocalSongAction(localActionKey, 'create');
		if (!localAction) return;
		const selectionToken = selectionGeneration;
		const published = Boolean(
			event.detail.isPublished !== undefined ? event.detail.isPublished : isPublished
		);
		uploadErrorsBySong = withoutMapKey(uploadErrorsBySong, primaryOutcomeKey);
		uploadWarningsBySong = withoutMapKey(uploadWarningsBySong, primaryOutcomeKey);
		driveOutcome = undefined;
		primarySaveSuccess = undefined;

		try {
			const submittedDisplayId = Number(displayId);
			const displayIdForCreate =
				submittedDisplayId === 0 ||
				(autoPopulatedDisplayId?.path === song.path &&
					autoPopulatedDisplayId.value === submittedDisplayId)
					? null
					: submittedDisplayId;
			const simfileData: CreateSimfileRecordInput = {
				title: String(song.songTitle || song.name || ''),
				artist: String(parsedLocalData.artist || ''),
				bpm: Number(parsedLocalData.bpm || 0),
				displayId: displayIdForCreate,
				isPublished: published,
				publishDate: String(publishDate),
				downloadUrl: String(downloadUrl),
				videoPreviewUrl: String(videoPreviewUrl),
				levels: Array.isArray(parsedLocalData.levels)
					? parsedLocalData.levels.map((level) => ({
							label: String(level.label || ''),
							level: Number(level.level || 0)
						}))
					: [],
				songPath: String(song.path || '')
			};

			const outcome = await googleDriveService.saveAndUpload({
				save: async () => {
					const result = await desktopHost.createSimfileRecord(simfileData);
					if (!result.success || !result.data) {
						return {
							success: false,
							error: result.error || 'Failed to create simfile record'
						};
					}

					const linkedSimfile = result.data;
					const savedSimfileId = result.simfileId || String(result.data.id);
					targetSong.linkedSimFileId = savedSimfileId;
					targetSong.linkedSimFile = linkedSimfile;
					workspaceStore.linkSimFileToFolder(targetPath, linkedSimfile);
					if (
						isSelectionCurrent({
							generation: selectionGeneration,
							token: selectionToken,
							currentPath: song.path,
							targetPath
						})
					) {
						song = { ...targetSong };
						primarySaveSuccess = {
							simfileId: savedSimfileId,
							messageKey: published
								? 'googleDrive.songDetails.published'
								: 'googleDrive.songDetails.draftSaved'
						};
					}

					if (result.warnings && result.warnings.length > 0) {
						console.warn('Preview upload warnings:', result.warnings);
						uploadWarningsBySong = new Map(uploadWarningsBySong).set(
							primaryOutcomeKey,
							[...result.warnings]
						);
					}

					return { success: true, simfileId: savedSimfileId };
				},
				workspacePath,
				songPath: targetPath,
				driveConnected: $googleDriveStore.connection?.connected === true
			});

			if (!outcome.simfileSave.success) {
				throw new Error(outcome.simfileSave.error || 'Failed to create simfile record');
			}
			const savedSimfileId = targetSong.linkedSimFileId || '';
			if (
				savedSimfileId &&
				isSelectionCurrent({
					generation: selectionGeneration,
					token: selectionToken,
					currentPath: song.path,
					targetPath
				}) &&
				song.linkedSimFileId === savedSimfileId
			) {
				driveOutcome = {
					simfileId: savedSimfileId,
					result: outcome.driveUpload,
					source: 'automatic'
				};
			}
			if (savedSimfileId) {
				mergeSuccessfulDriveFields(
					targetSong,
					targetPath,
					savedSimfileId,
					outcome.driveUpload
				);
			}
		} catch (error) {
			console.error('Error uploading song:', error);
			const uploadErrorOutcome = {
				id: ++primaryOutcomeSequence,
				message: error instanceof Error ? error.message : 'Failed to upload song'
			};
			uploadErrorsBySong = new Map(uploadErrorsBySong).set(
				primaryOutcomeKey,
				uploadErrorOutcome
			);

			// Clear error message after 10 seconds
			setTimeout(() => {
				if (uploadErrorsBySong.get(primaryOutcomeKey)?.id !== uploadErrorOutcome.id) {
					return;
				}
				uploadErrorsBySong = withoutMapKey(uploadErrorsBySong, primaryOutcomeKey);
			}, 10000);
		} finally {
			finishLocalSongAction(localActionKey, localAction);
		}
	};

	const populateNextDisplayId = async (currentPath: string) => {
		if (shouldSkipAutoPopulate(autoPopulateInFlightPaths, currentPath)) {
			return;
		}

		// Restore cached value on revisit without re-fetching
		const cachedId = getCachedDisplayId(autoPopulatedForPaths, currentPath);
		if (cachedId !== undefined) {
			if (displayId === 0) {
				displayId = cachedId;
				autoPopulatedDisplayId = { path: currentPath, value: cachedId };
			}
			return;
		}

		// Mark path synchronously before async call to prevent duplicate IPC invocations
		autoPopulateInFlightPaths.add(currentPath);

		try {
			const next = await simFileService.getNextDisplayId();
			if (!Number.isSafeInteger(next)) {
				throw new Error('Invalid next displayId response');
			}
			// Record that we fetched for this path even if user navigated away,
			// to prevent duplicate calls if they navigate back
			autoPopulatedForPaths.set(currentPath, next);
			// Guard against stale responses: skip mutation if user switched songs
			if (song.path !== currentPath) return;
			if (displayId === 0) {
				displayId = next;
				autoPopulatedDisplayId = { path: currentPath, value: next };
			}
			displayIdAutoPopulateError = null;
		} catch (error) {
			console.warn('Failed to fetch next displayId:', error);
			// Guard against stale rejections: skip error mutation if user switched songs
			if (song.path !== currentPath) return;
			displayIdAutoPopulateError =
				'Could not fetch the next display ID. You can enter it manually or retry.';
		} finally {
			autoPopulateInFlightPaths.delete(currentPath);
		}
	};

	const handleRetryDisplayIdAutoPopulate = () => {
		if (!song.path || song.linkedSimFile || !$authStore.isAuthenticated) return;
		displayIdAutoPopulateError = null;
		void populateNextDisplayId(song.path);
	};

	// Handle showing autocomplete popup
	const handleShowAutocomplete = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();

		// Center the popup on screen
		autocompletePosition = {
			top: window.innerHeight / 2 - 200, // Subtract half of estimated popup height
			left: window.innerWidth / 2 - 200, // Subtract half of popup width (400px)
			width: 400
		};

		showAutocomplete = true;
	};

	// Handle cloud song selection from autocomplete
	const handleCloudSongSelect = (selectedSong: CloudSong) => {
		void (async () => {
			showAutocomplete = false;

			if (!selectedSong || !song.path) return;

			isLinking = true;
			linkingError = null;
			linkingSuccess = false;

			try {
				const result = await desktopHost.fetchCloudSong(selectedSong.id);

				if (result.success && result.cloudSongData) {
					const linkedSimfile = result.cloudSongData;
					linkingSuccess = true;
					song.linkedSimFileId = String(linkedSimfile.id);
					song.linkedSimFile = linkedSimfile;

					// Update the workspace store (this will automatically cache to localStorage)
					workspaceStore.linkSimFileToFolder(song.path, linkedSimfile);

					// Hide success message after 3 seconds
					setTimeout(() => {
						linkingSuccess = false;
					}, 3000);
				} else {
					throw new Error(result.error || 'Failed to link song to cloud');
				}
			} catch (error) {
				console.error('Error linking song to cloud:', error);
				linkingError =
					error instanceof Error ? error.message : 'Failed to link song to cloud';

				// Clear error message after 10 seconds
				setTimeout(() => {
					linkingError = null;
				}, 10000);
			} finally {
				isLinking = false;
			}
		})();
	};

	// Handle updating linked simfile
	const handleUpdateSimfile = async (event: CustomEvent) => {
		if (!song.linkedSimFile || !song.linkedSimFileId) {
			console.error('No linked simfile to update');
			return;
		}

		const targetSong = song;
		const targetPath = song.path;
		const simfileId = song.linkedSimFileId;
		const workspacePath = $workspaceStore.path || '';
		const localActionKey = getLocalSongActionKey(targetSong, workspacePath);
		const primaryOutcomeKey = getPrimaryOutcomeKey(targetSong, workspacePath);
		if (currentDriveOperation) return;
		const localAction = beginLocalSongAction(localActionKey, 'update');
		if (!localAction) return;
		const selectionToken = selectionGeneration;
		const published = Boolean(event.detail.isPublished);
		updateErrorsBySong = withoutMapKey(updateErrorsBySong, primaryOutcomeKey);
		driveOutcome = undefined;
		primarySaveSuccess = undefined;

		try {
			// Build update data object
			// Omit downloadUrl for Drive-bound records: the Drive upload flow
			// owns the URL via the guarded updateSimfileDriveFile mutation.
			// Sending a cached downloadUrl here would reintroduce the
			// cross-device race where a stale URL overwrites a newer binding.
			const isDriveBound = Boolean(targetSong.linkedSimFile?.googleDriveFileId);
			const updateData: UpdateSimfileRecordInput = {
				displayId: Number(event.detail.displayId),
				publishDate: String(event.detail.publishDate),
				isPublished: Boolean(event.detail.isPublished),
				videoPreviewUrl: String(event.detail.videoPreviewUrl)
			};
			if (!isDriveBound) {
				updateData.downloadUrl = String(event.detail.downloadUrl);
			}

			// Add parsed local data if available (BPM, artist, title)
			if (parsedLocalData.bpm) {
				updateData.bpm = parsedLocalData.bpm;
			}
			if (parsedLocalData.artist) {
				updateData.artist = parsedLocalData.artist;
			}
			if (song.songTitle || song.name) {
				updateData.title = song.songTitle || song.name;
			}

			const outcome = await googleDriveService.saveAndUpload({
				save: async () => {
					const result = await desktopHost.updateSimfileRecord({
						simfileId,
						updateData
					});
					if (!result.success || !targetSong.linkedSimFile) {
						return {
							success: false,
							error: result.error || 'Failed to update simfile'
						};
					}

					const updatedSimfile: SimfileModel = {
						...targetSong.linkedSimFile,
						...(result.data || {})
					};
					targetSong.linkedSimFile = updatedSimfile;
					workspaceStore.linkSimFileToFolder(targetPath, updatedSimfile);
					if (
						isSelectionCurrent({
							generation: selectionGeneration,
							token: selectionToken,
							currentPath: song.path,
							targetPath
						})
					) {
						primarySaveSuccess = {
							simfileId,
							messageKey: published
								? 'googleDrive.songDetails.published'
								: 'googleDrive.songDetails.draftSaved'
						};
					}
					return { success: true, simfileId };
				},
				workspacePath,
				songPath: targetPath,
				driveConnected: $googleDriveStore.connection?.connected === true
			});

			if (!outcome.simfileSave.success) {
				throw new Error(outcome.simfileSave.error || 'Failed to update simfile');
			}
			if (
				isSelectionCurrent({
					generation: selectionGeneration,
					token: selectionToken,
					currentPath: song.path,
					targetPath
				}) &&
				song.linkedSimFileId === simfileId
			) {
				driveOutcome = {
					simfileId,
					result: outcome.driveUpload,
					source: 'automatic'
				};
			}
			mergeSuccessfulDriveFields(targetSong, targetPath, simfileId, outcome.driveUpload);
		} catch (error) {
			console.error('Error updating simfile:', error);
			const updateErrorOutcome = {
				id: ++primaryOutcomeSequence,
				message: error instanceof Error ? error.message : 'Failed to update simfile'
			};
			updateErrorsBySong = new Map(updateErrorsBySong).set(
				primaryOutcomeKey,
				updateErrorOutcome
			);

			// Clear error message after 10 seconds
			setTimeout(() => {
				if (updateErrorsBySong.get(primaryOutcomeKey)?.id !== updateErrorOutcome.id) {
					return;
				}
				updateErrorsBySong = withoutMapKey(updateErrorsBySong, primaryOutcomeKey);
			}, 10000);
		} finally {
			finishLocalSongAction(localActionKey, localAction);
		}
	};

	// Handle exporting song to zip
	const handleExportToZip = async () => {
		if (!song.path) {
			console.error('No song path available for export');
			return;
		}

		isExporting = true;
		exportError = null;
		exportSuccess = false;
		exportedFilePath = null;

		try {
			const zipFileName = song.name || 'song';
			const result = await desktopHost.exportSongToZip<ExportSongResult>({
				songPath: song.path,
				songTitle: zipFileName,
				exportDirectory: currentSettings.exportDirectory
			});

			if (result.success) {
				exportSuccess = true;
				exportedFilePath = result.zipPath;
				console.log(
					`Export successful: ${result.filesCount} files exported to ${result.zipPath}`
				);

				// Hide success message after 8 seconds
				setTimeout(() => {
					exportSuccess = false;
					exportedFilePath = null;
				}, 8000);
			} else {
				throw new Error(result.error || 'Failed to export song');
			}
		} catch (error) {
			console.error('Error exporting song:', error);
			exportError = error instanceof Error ? error.message : 'Failed to export song';

			// Clear error message after 10 seconds
			setTimeout(() => {
				exportError = null;
			}, 10000);
		} finally {
			isExporting = false;
		}
	};

	const handleDriveUpload = async (forceCreateReplacement = false): Promise<void> => {
		if (
			currentDriveOperation ||
			!song.path ||
			!song.linkedSimFileId ||
			!$workspaceStore.path ||
			!$googleDriveStore.connection?.connected
		) {
			return;
		}

		const targetSong = song;
		const targetPath = song.path;
		const simfileId = song.linkedSimFileId;
		const workspacePath = $workspaceStore.path;
		const localActionKey = getLocalSongActionKey(targetSong, workspacePath);
		const localAction = beginLocalSongAction(localActionKey, 'drive');
		if (!localAction) return;
		const selectionToken = selectionGeneration;
		driveOutcome = undefined;
		try {
			const outcome = await googleDriveService.uploadSongZip({
				simfileId,
				workspacePath,
				songPath: targetPath,
				...(forceCreateReplacement ? { forceCreateReplacement: true } : {})
			});
			if (
				isSelectionCurrent({
					generation: selectionGeneration,
					token: selectionToken,
					currentPath: song.path,
					targetPath
				}) &&
				song.linkedSimFileId === simfileId
			) {
				driveOutcome = {
					simfileId,
					result: outcome.driveUpload,
					source: 'manual'
				};
			}
			mergeSuccessfulDriveFields(targetSong, targetPath, simfileId, outcome.driveUpload);
		} finally {
			finishLocalSongAction(localActionKey, localAction);
		}
	};

	const handleRetryDriveUpload = (): void => {
		if (!currentDriveOutcome || currentDriveOutcome.simfileId !== song.linkedSimFileId) return;
		void handleDriveUpload(false);
	};

	const handleCreateReplacementDriveFile = (): void => {
		if (!currentDriveOutcome || currentDriveOutcome.simfileId !== song.linkedSimFileId) return;
		void handleDriveUpload(true);
	};

	// Effect to parse local DTX files when needed
	$effect(() => {
		// Only parse local files if we have a folder path and linked simfile data is missing key information
		const shouldParse =
			song.path &&
			(!song.linkedSimFile ||
				song.linkedSimFile.bpm === undefined ||
				song.linkedSimFile.bpm === null ||
				song.linkedSimFile.artist === undefined ||
				song.linkedSimFile.artist === null ||
				song.linkedSimFile.artist === '');

		if (shouldParse) {
			// Use async function inside effect
			(async () => {
				try {
					const result = await desktopHost.parseDtxFiles<{
						bpm?: number;
						artist?: string;
						levels?: { label: string; level: number }[];
					} | null>(song.path);

					if (result) {
						parsedLocalData = {
							bpm: result.bpm,
							artist: result.artist,
							levels: result.levels || []
						};
					} else {
						parsedLocalData = {};
					}
				} catch (error) {
					console.warn('Failed to parse local DTX files via IPC:', error);
					parsedLocalData = {};
				}
			})();
		} else {
			parsedLocalData = {};
		}
	});

	// Convert song data to simfile format for ChartDetail component
	// Use parsed local data as fallback when linked simfile data is missing
	const simfileData = $derived(() => {
		const linkedSimfile = song.linkedSimFile;
		const fallbackDtxFiles: SimfileDtxFile[] = parsedLocalData.levels
			? parsedLocalData.levels.map((l, index) => ({
					id: index + 1,
					label: l.label || 'Unknown',
					// Store the raw #DLEVEL value directly — formatLevel decodes it
					// via the DTXManiaCX formula (≥100 → /100, <100 → /10).
					// Mirrors the upload site and DTXFile.level in @dtx/common.
					level: Number(l.level || 0)
				}))
			: [];
		const dtxFiles: SimfileDtxFile[] =
			linkedSimfile?.dtxFiles?.map((file, index) => ({
				...file,
				level: file?.level !== undefined ? Number(file.level) : undefined,
				id: (file as { id?: number })?.id ?? index + 1
			})) || fallbackDtxFiles;

		return {
			title: linkedSimfile?.title || song.songTitle || song.name,
			artist: linkedSimfile?.artist || parsedLocalData.artist,
			bpm: linkedSimfile?.bpm ?? parsedLocalData.bpm,
			publishDate: linkedSimfile?.publishDate || publishDate,
			displayId: linkedSimfile?.displayId ?? displayId,
			isPublished: linkedSimfile?.isPublished ?? false,
			downloadUrl: linkedSimfile?.downloadUrl || downloadUrl,
			videoPreviewUrl: linkedSimfile?.videoPreviewUrl || videoPreviewUrl,
			dtxFiles
		} satisfies Partial<SimfileModel>;
	});

	// Reset auto-populate state when switching songs to prevent stale IDs
	$effect(() => {
		const currentPath = song.path;
		// Access song.path to track changes, then reset auto-populate state
		if (currentPath) {
			displayId = 0;
			autoPopulatedDisplayId = null;
			displayIdAutoPopulateError = null;
		}
	});

	// Initialize reactive form values from simfileData
	$effect(() => {
		const data = simfileData();
		// Always update form values to reflect current data
		displayId = data.displayId || 0;
		publishDate = data.publishDate || new Date().toISOString().split('T')[0];
		downloadUrl = data.downloadUrl || '';
		videoPreviewUrl = data.videoPreviewUrl || '';
		isPublished = data.isPublished || false;
	});

	$effect(() => {
		const currentPath = song.path;
		if (!currentPath || song.linkedSimFile || !$authStore.isAuthenticated) return;
		void populateNextDisplayId(currentPath);
	});

	$effect(() => {
		if (song.path === selectedSongPath) return;
		selectedSongPath = song.path;
		selectionGeneration += 1;
		primarySaveSuccess = undefined;
		driveOutcome = undefined;
	});
</script>

{#if currentPrimarySaveSuccess && $authStore.isAuthenticated}
	<p class="border-green/40 bg-green/10 text-green m-4 rounded-lg border p-3 text-sm">
		{$_(currentPrimarySaveSuccess.messageKey)}
	</p>
{/if}

{#if currentDriveOutcome?.source === 'automatic' && currentDriveOutcome.result.status === 'failed'}
	<p class="border-yellow/40 bg-yellow/10 text-yellow m-4 rounded-lg border p-3 text-sm">
		{$_('googleDrive.songDetails.previousDownloadPreserved')}
	</p>
{/if}

{#if currentSimfileId}
	<GoogleDriveUploadStatus
		simfileId={currentSimfileId}
		outcome={currentDriveOutcome}
		onRetry={handleRetryDriveUpload}
		onCreateReplacement={handleCreateReplacementDriveFile}
	/>
{/if}

{#if uploadWarnings.length > 0 && $authStore.isAuthenticated}
	<div class="border-amber/40 bg-amber/10 m-4 rounded-lg border p-3">
		<div class="flex flex-col gap-1">
			<span class="text-amber text-sm font-medium">
				{$_('googleDrive.songDetails.uploadWarningsHeading')}
			</span>
			{#each uploadWarnings as warning}
				<span class="text-amber text-xs">{warning}</span>
			{/each}
		</div>
	</div>
{/if}

{#if song.linkedSimFile}
	<!-- For linked songs, use the built-in Update button -->
	<div class="flex h-full flex-col">
		<div
			class="border-hairline bg-surface-1 flex items-center justify-between gap-2 border-b p-6 pb-4"
		>
			<div class="flex items-center gap-2">
				<Music size={20} class="text-cyan" />
				<h2 class="font-display text-hi text-xl">Song Details</h2>
			</div>
			<div class="flex items-center gap-2">
				<button
					class="bg-magenta flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-[#16001a] transition duration-150 ease-in-out hover:opacity-90 focus:outline-none"
					style="box-shadow:0 0 22px -6px var(--color-magenta)"
					onclick={handleOpenEditor}
					aria-label="Open Editor"
				>
					<Music size={16} />
					Open Editor
				</button>
				<button
					class="bg-surface-2 text-cyan flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition duration-150 ease-in-out hover:opacity-90 focus:outline-none"
					onclick={handleExportToZip}
					disabled={isExporting}
					aria-label="Export to ZIP"
				>
					{#if isExporting}
						<div
							class="border-cyan h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
						></div>
						Exporting...
					{:else}
						<Upload size={16} />
						Export to ZIP
					{/if}
				</button>
				<button
					class="bg-surface-2 text-cyan flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition duration-150 ease-in-out hover:opacity-90 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					onclick={() => handleDriveUpload(false)}
					disabled={isDriveActionInProgress ||
						isUpdating ||
						currentDriveOperation !== undefined ||
						!$googleDriveStore.connection?.connected}
					aria-label={$_(
						song.linkedSimFile.googleDriveFileId
							? 'googleDrive.songDetails.reupload'
							: 'googleDrive.songDetails.upload'
					)}
				>
					<Upload size={16} />
					{$_(
						song.linkedSimFile.googleDriveFileId
							? 'googleDrive.songDetails.reupload'
							: 'googleDrive.songDetails.upload'
					)}
				</button>
				<button
					class="bg-surface-2 text-cyan flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition duration-150 ease-in-out hover:opacity-90 focus:outline-none"
					onclick={handleClose}
					aria-label="Close"
				>
					<X size={16} />
					Close
				</button>
			</div>
		</div>

		{#if song.linkedSimFile.googleDriveFileId}
			<p class="border-amber/40 bg-amber/10 text-amber m-4 rounded-lg border p-3 text-sm">
				{$_('googleDrive.songDetails.linkedWarning')}
			</p>
		{/if}

		<ChartDetail
			simfile={simfileData()}
			showEditor={false}
			showPublishingControls={$authStore.isAuthenticated &&
				!isUpdating &&
				!isDriveActionInProgress &&
				!currentDriveOperation}
			showPublishedToggle={$authStore.isAuthenticated &&
				!isUpdating &&
				!isDriveActionInProgress &&
				!currentDriveOperation}
			saveButtonText={$authStore.isAuthenticated ? 'Update' : ''}
			bind:displayId
			bind:publishDate
			bind:downloadUrl
			bind:videoPreviewUrl
			bind:isPublished
			on:onSave={$authStore.isAuthenticated ? handleUpdateSimfile : () => {}}
		>
			{#snippet desktop_info()}
				<!-- Status Section - This will be rendered outside the grid -->
				<div class="border-green/40 bg-green/10 rounded-lg border p-3">
					<div class="flex items-center gap-2">
						<Link size={16} class="text-green" />
						<span class="text-green font-semibold">
							{song.linkedSimFile.title}
						</span>
						<span class="bg-green/20 text-green rounded px-2 py-1 text-xs font-medium">
							Linked
						</span>
					</div>
				</div>

				<!-- Update Status Messages -->
				{#if isUpdating && $authStore.isAuthenticated}
					<div class="border-cyan/40 bg-cyan/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<div
								class="border-cyan h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
							></div>
							<span class="text-cyan text-sm"> Updating cloud song... </span>
						</div>
					</div>
				{/if}

				{#if updateError && $authStore.isAuthenticated}
					<div class="border-red/40 bg-red/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<span class="text-red text-sm">
								Update failed: {updateError}
							</span>
						</div>
					</div>
				{/if}

				<!-- Export Status Messages -->
				{#if isExporting}
					<div class="border-cyan/40 bg-cyan/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<div
								class="border-cyan h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
							></div>
							<span class="text-cyan text-sm"> Exporting song to ZIP... </span>
						</div>
					</div>
				{/if}

				{#if exportError}
					<div class="border-red/40 bg-red/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<span class="text-red text-sm">
								Export failed: {exportError}
							</span>
						</div>
					</div>
				{/if}

				{#if exportSuccess}
					<div class="border-green/40 bg-green/10 rounded-lg border p-3">
						<div class="flex flex-col gap-1">
							<span class="text-green text-sm font-medium">
								Song exported to ZIP successfully!
							</span>
							{#if exportedFilePath}
								<span class="text-green font-mono text-xs break-all">
									Saved to: {exportedFilePath}
								</span>
							{/if}
						</div>
					</div>
				{/if}
			{/snippet}

			{#snippet folder_upload()}
				<!-- Folder Name -->
				<div class="col-span-1 flex items-center">
					<span class="text-dim mr-2 block">Folder:</span>
				</div>
				<div class="col-span-7">
					<span class="text-hi font-mono text-sm">{song.name}</span>
				</div>

				<!-- Song Path -->
				<div class="col-span-1 flex items-center">
					<span class="text-dim mr-2 block">Path:</span>
				</div>
				<div class="col-span-7">
					<span class="text-hi truncate font-mono text-sm">{song.path}</span>
				</div>
			{/snippet}

			{#snippet local_files()}
				<!-- Local Asset Files Section -->
				<div class="bg-surface-2 rounded-lg">
					{#if isLoadingFiles}
						<div class="flex justify-center p-4">
							<p class="text-dim">Loading files...</p>
						</div>
					{:else if fileLoadError}
						<div class="text-red p-4">
							<p>{fileLoadError}</p>
							<button
								class="bg-magenta mt-2 rounded-sm px-3 py-1 text-sm text-[#16001a] hover:opacity-90"
								onclick={loadLocalFiles}
							>
								Retry
							</button>
						</div>
					{:else}
						<!-- Use UploadedAssetFiles component for local files display -->
						<UploadedAssetFiles
							simfileId={song.linkedSimFileId?.toString() || ''}
							userFiles={localFiles}
							simfileBucketUrl=""
							loadAssetFiles={loadAssetFilesForDesktop}
							uploadFile={(fileName, songFolderPath, simfileId) =>
								desktopHost.uploadFile(fileName, songFolderPath, simfileId)}
							isDesktop={true}
							songFolderPath={song.path || ''}
							disableUploads={!$authStore.isAuthenticated}
						/>
					{/if}
				</div>
			{/snippet}
		</ChartDetail>
	</div>
{:else}
	<!-- For unlinked songs, use custom upload buttons -->
	<div class="flex h-full flex-col">
		<ChartDetail
			simfile={simfileData()}
			showEditor={false}
			showPublishingControls={true}
			showPublishedToggle={false}
			bind:displayId
			bind:publishDate
			bind:downloadUrl
			bind:videoPreviewUrl
			bind:isPublished
			on:onSave={handleUploadSong}
		>
			{#snippet header()}
				<!-- Header -->
				<div
					class="border-hairline bg-surface-1 flex items-center justify-between gap-2 border-b p-6 pb-4"
				>
					<div class="flex items-center gap-2">
						<Music size={20} class="text-cyan" />
						<h2 class="font-display text-hi text-xl">Song Details</h2>
					</div>
					<div class="flex items-center gap-2">
						<button
							class="bg-magenta flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-[#16001a] transition duration-150 ease-in-out hover:opacity-90 focus:outline-none"
							style="box-shadow:0 0 22px -6px var(--color-magenta)"
							onclick={handleOpenEditor}
							aria-label="Open Editor"
						>
							<Music size={16} />
							Open Editor
						</button>
						<button
							class="bg-surface-2 text-cyan flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition duration-150 ease-in-out hover:opacity-90 focus:outline-none"
							onclick={handleExportToZip}
							disabled={isExporting}
							aria-label="Export to ZIP"
						>
							{#if isExporting}
								<div
									class="border-cyan h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
								></div>
								Exporting...
							{:else}
								<Upload size={16} />
								Export to ZIP
							{/if}
						</button>
						<button
							class="bg-surface-2 text-cyan flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition duration-150 ease-in-out hover:opacity-90 focus:outline-none"
							onclick={handleClose}
							aria-label="Close"
						>
							<X size={16} />
							Close
						</button>
					</div>
				</div>
			{/snippet}

			{#snippet desktop_info()}
				<!-- Status Section - This will be rendered outside the grid -->
				{#if song.containsDtxFiles && $authStore.isAuthenticated}
					<div class="border-amber/40 bg-amber/10 rounded-lg border p-3">
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								<Music size={16} class="text-amber" />
								<span class="text-amber text-sm">
									Not linked - Local song not yet uploaded to cloud
								</span>
							</div>
							<button
								class="bg-magenta flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-[#16001a] transition duration-150 ease-in-out hover:opacity-90 focus:outline-none"
								style="box-shadow:0 0 22px -6px var(--color-magenta)"
								data-cloud-song-autocomplete-trigger
								onclick={handleShowAutocomplete}
								disabled={isLinking}
							>
								{#if isLinking}
									<div
										class="h-3 w-3 animate-spin rounded-full border border-[#16001a] border-t-transparent"
									></div>
									Linking...
								{:else}
									<Search size={14} />
									Link to Cloud
								{/if}
							</button>
						</div>
					</div>
				{/if}

				{#if displayIdAutoPopulateError && $authStore.isAuthenticated}
					<div class="border-amber/40 bg-amber/10 rounded-lg border p-3">
						<div class="flex items-center justify-between gap-2">
							<span class="text-amber text-sm">
								{displayIdAutoPopulateError}
							</span>
							<button
								class="bg-surface-2 text-cyan rounded px-3 py-1 text-sm font-medium hover:opacity-90 focus:outline-none"
								onclick={handleRetryDisplayIdAutoPopulate}
							>
								Retry
							</button>
						</div>
					</div>
				{/if}

				<!-- Linking Status Messages -->
				{#if isLinking && $authStore.isAuthenticated}
					<div class="border-cyan/40 bg-cyan/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<div
								class="border-cyan h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
							></div>
							<span class="text-cyan text-sm"> Linking song to cloud... </span>
						</div>
					</div>
				{/if}

				{#if linkingError && $authStore.isAuthenticated}
					<div class="border-red/40 bg-red/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<span class="text-red text-sm">
								Linking failed: {linkingError}
							</span>
						</div>
					</div>
				{/if}

				{#if linkingSuccess && $authStore.isAuthenticated}
					<div class="border-green/40 bg-green/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<span class="text-green text-sm">
								Song linked successfully! It is now linked to the cloud.
							</span>
						</div>
					</div>
				{/if}

				<!-- Upload Status Messages -->
				{#if isUploading && $authStore.isAuthenticated}
					<div class="border-cyan/40 bg-cyan/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<div
								class="border-cyan h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
							></div>
							<span class="text-cyan text-sm"> Uploading song to cloud... </span>
						</div>
					</div>
				{/if}

				{#if uploadError && $authStore.isAuthenticated}
					<div class="border-red/40 bg-red/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<span class="text-red text-sm">
								Upload failed: {uploadError}
							</span>
						</div>
					</div>
				{/if}

				<!-- Export Status Messages -->
				{#if isExporting}
					<div class="border-cyan/40 bg-cyan/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<div
								class="border-cyan h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
							></div>
							<span class="text-cyan text-sm"> Exporting song to ZIP... </span>
						</div>
					</div>
				{/if}

				{#if exportError}
					<div class="border-red/40 bg-red/10 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<span class="text-red text-sm">
								Export failed: {exportError}
							</span>
						</div>
					</div>
				{/if}

				{#if exportSuccess}
					<div class="border-green/40 bg-green/10 rounded-lg border p-3">
						<div class="flex flex-col gap-1">
							<span class="text-green text-sm font-medium">
								Song exported to ZIP successfully!
							</span>
							{#if exportedFilePath}
								<span class="text-green font-mono text-xs break-all">
									Saved to: {exportedFilePath}
								</span>
							{/if}
						</div>
					</div>
				{/if}
			{/snippet}

			{#snippet folder_upload()}
				<!-- Folder Name -->
				<div class="col-span-1 flex items-center">
					<span class="text-dim mr-2 block">Folder:</span>
				</div>
				<div class="col-span-7">
					<span class="text-hi font-mono text-sm">{song.name}</span>
				</div>

				<!-- Song Path -->
				<div class="col-span-1 flex items-center">
					<span class="text-dim mr-2 block">Path:</span>
				</div>
				<div class="col-span-7">
					<span class="text-hi truncate font-mono text-sm">{song.path}</span>
				</div>
			{/snippet}

			{#snippet local_files()}
				<!-- Local Asset Files Section -->
				<div class="bg-surface-2 rounded-lg">
					{#if isLoadingFiles}
						<div class="flex justify-center p-4">
							<p class="text-dim">Loading files...</p>
						</div>
					{:else if fileLoadError}
						<div class="text-red p-4">
							<p>{fileLoadError}</p>
							<button
								class="bg-magenta mt-2 rounded-sm px-3 py-1 text-sm text-[#16001a] hover:opacity-90"
								onclick={loadLocalFiles}
							>
								Retry
							</button>
						</div>
					{:else}
						<!-- Use UploadedAssetFiles component for local files display -->
						<UploadedAssetFiles
							simfileId={song.linkedSimFileId?.toString() || ''}
							userFiles={localFiles}
							simfileBucketUrl=""
							loadAssetFiles={loadAssetFilesForDesktop}
							uploadFile={(fileName, songFolderPath, simfileId) =>
								desktopHost.uploadFile(fileName, songFolderPath, simfileId)}
							isDesktop={true}
							songFolderPath={song.path || ''}
							disableUploads={!$authStore.isAuthenticated}
						/>
					{/if}
				</div>
			{/snippet}

			{#snippet save()}
				{#if song.containsDtxFiles && $authStore.isAuthenticated}
					<div class="flex gap-2">
						{#if isUploading}
							<div class="flex items-center gap-2">
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								></div>
								Uploading...
							</div>
						{:else}
							<button
								class="bg-magenta rounded-sm px-4 py-2 font-bold text-[#16001a] hover:opacity-90"
								onclick={() => triggerSave(false)}
							>
								Upload as Draft
							</button>
							<button
								class="bg-green rounded-sm px-4 py-2 font-bold text-[#16001a] hover:opacity-90"
								onclick={() => triggerSave(true)}
							>
								Upload and Publish
							</button>
						{/if}
					</div>
				{/if}
			{/snippet}
		</ChartDetail>
	</div>
{/if}

<!-- Autocomplete Popup -->
{#if $authStore.isAuthenticated}
	<CloudSongAutocomplete
		isOpen={showAutocomplete}
		position={autocompletePosition}
		excludeLinkedSongIds={getLinkedSongIds()}
		onclose={() => (showAutocomplete = false)}
		onselect={handleCloudSongSelect}
	/>
{/if}
