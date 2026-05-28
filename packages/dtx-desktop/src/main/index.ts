import { app, shell, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { SimFile, VALID_DTX_FILE_EXTENSIONS } from '@dtx/common/server';
import { validateSession, getCurrentSession, logoutSession, handleProtocolUrl } from './auth';
import { getSimfile, getSimfileWithFiles, updateSimfile, simfileSearch } from './api-client';
import { toRendererSimfile } from './simfile-mapper';
import { uploadFile } from './upload';
import {
	fetchUserSimFiles,
	getPreviewUrl,
	getSoundPreviewUrl,
	createSimfileRecord,
	CreateSimfileData,
	parseDtxFiles,
	getNextDisplayId
} from './simfile-service';
import { loadTreeStructure, selectDirectory, readFile } from './filesystem';
import { createWindow } from './window';

// Make sure we're the only instance of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.quit();
} else {
	// This method will be called when Electron has finished
	// initialization and is ready to create browser windows.
	// Some APIs can only be used after this event occurs.
	app.whenReady().then(() => {
		// Set app user model id for windows
		app.setAppUserModelId('com.electron');

		// IPC test
		ipcMain.on('ping', () => {});

		// Handle external URL opening request from renderer
		ipcMain.on('open-external-url', (_event, url) => {
			shell.openExternal(url);
		});

		// Handle folder selection dialog (new song creation and templates)
		ipcMain.handle('select-folder', selectDirectory);

		// Handle path existence check
		ipcMain.handle('path-exists', async (_event, basePath, ...pathParts) => {
			try {
				let fullPath;
				if (pathParts.length === 0) {
					// Single path argument (backward compatibility)
					fullPath = basePath;
				} else {
					// Multiple path parts to join
					fullPath = path.join(basePath, ...pathParts);
				}
				await fs.promises.access(fullPath);
				return { exists: true, error: null };
			} catch (error) {
				const maybeErrno = error as NodeJS.ErrnoException;
				if (maybeErrno?.code === 'ENOENT') {
					return { exists: false, error: 'not-found' };
				}
				if (maybeErrno?.code === 'EACCES') {
					return { exists: false, error: 'permission-denied' };
				}
				return { exists: false, error: maybeErrno?.code ?? 'unknown' };
			}
		});

		// Handle directory listing for chart switching
		ipcMain.handle('list-directory', async (_event, dirPath) => {
			try {
				const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

				const files = entries
					.filter((entry) => entry.isFile())
					.map((file) => ({
						name: file.name,
						path: path.join(dirPath, file.name),
						type: 'file'
					}));

				const directories = entries
					.filter((entry) => entry.isDirectory())
					.map((dir) => ({
						name: dir.name,
						path: path.join(dirPath, dir.name),
						type: 'directory'
					}));

				return {
					files: [...files, ...directories],
					error: null
				};
			} catch (error) {
				console.error('Error listing directory:', error);
				return {
					files: [],
					error: error instanceof Error ? error.message : 'Unknown error'
				};
			}
		});

		// Handle opening folder in explorer/finder
		ipcMain.handle('open-folder-in-explorer', async (_event, folderPath) => {
			const result = await shell.openPath(folderPath);
			if (result === '') {
				return { success: true };
			} else {
				console.error('Error opening folder in explorer:', result);
				return {
					success: false,
					error: result
				};
			}
		});

		// Handle consolidated song creation
		ipcMain.handle('create-song', async (_event, options) => {
			try {
				const { selectedPath, sanitizedFolderName, sanitizedSongName, templateFolderPath } =
					options;

				// Check if folder already exists
				const songFolderPath = path.join(selectedPath, sanitizedFolderName);
				try {
					await fs.promises.access(songFolderPath);
					throw new Error(
						`A folder named "${sanitizedFolderName}" already exists in the selected location`
					);
				} catch (accessError: unknown) {
					const maybeErrno = accessError as NodeJS.ErrnoException;
					// If the error is NOT ENOENT, it means something else went wrong
					if (maybeErrno?.code !== 'ENOENT') {
						throw accessError as Error;
					}
					// ENOENT means the folder doesn't exist, which is what we want
				}

				// Create the song folder
				await fs.promises.mkdir(songFolderPath, { recursive: true });

				// If a template is provided, copy its contents to the new folder
				if (templateFolderPath) {
					// Normalize paths to resolve any relative components and ensure consistent separators
					const normalizedSource = path.resolve(templateFolderPath);
					const normalizedDest = path.resolve(songFolderPath);

					// Guard against copying into a descendant of the source directory
					if (
						normalizedDest.startsWith(normalizedSource + path.sep) ||
						normalizedDest === normalizedSource
					) {
						throw new Error('Cannot copy directory into itself or its subdirectory.');
					}

					const copyRecursively = async (src: string, dest: string) => {
						const entries = await fs.promises.readdir(src, { withFileTypes: true });

						for (const entry of entries) {
							const srcPath = path.join(src, entry.name);
							const destPath = path.join(dest, entry.name);

							if (entry.isDirectory()) {
								await fs.promises.mkdir(destPath, { recursive: true });
								await copyRecursively(srcPath, destPath);
							} else if (entry.isFile()) {
								await fs.promises.copyFile(srcPath, destPath);
							}
						}
					};

					await copyRecursively(templateFolderPath, songFolderPath);
				}

				// Create SET.def file using SimFile's generateDefFileContent method
				const simFile = new SimFile([]); // Empty files array for new SimFile
				simFile.title = sanitizedSongName;

				const setDefPath = path.join(songFolderPath, 'SET.def');
				const setDefContent = simFile.generateDefFileContent();

				// Write the SET.def file (this will overwrite template's SET.def if it exists)

				// Add UTF-16 LE BOM (0xFF 0xFE) and encode content
				const bom = Buffer.from([0xff, 0xfe]);
				const contentBuffer = Buffer.from(setDefContent, 'utf16le');
				const finalBuffer = Buffer.concat([bom, contentBuffer]);

				await fs.promises.writeFile(setDefPath, finalBuffer);

				return {
					success: true,
					songFolderPath
				};
			} catch (error) {
				console.error('Error creating song:', error);
				throw error;
			}
		});

		// Handle loading tree structure with lazy loading
		ipcMain.handle('load-tree-structure', async (_event, basePath, ...pathParts) => {
			let fullPath: string;
			if (pathParts.length === 0) {
				// Single path argument (backward compatibility)
				fullPath = basePath;
			} else {
				// Multiple path parts to join
				fullPath = path.join(basePath, ...pathParts);
			}
			return await loadTreeStructure(fullPath);
		});

		// Handle listing files in a directory
		ipcMain.handle('list-files', async (_event, dirPath) => {
			try {
				const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

				// Get all files with their stats
				const files = await Promise.all(
					entries
						.filter((entry) => entry.isFile())
						.map(async (file) => {
							const filePath = path.join(dirPath, file.name);
							const stats = await fs.promises.stat(filePath);
							return {
								fileName: file.name,
								size: stats.size,
								lastModified: stats.mtime.toISOString(),
								key: filePath // Use full path as key for local files
							};
						})
				);

				return { files };
			} catch (error) {
				console.error('Error listing files:', error);
				return {
					files: [],
					error: error instanceof Error ? error.message : 'Unknown error'
				};
			}
		});

		// Handle reading file contents
		ipcMain.handle('read-file', async (_event, filePath, workspaceRoot = null) => {
			return await readFile(filePath, workspaceRoot);
		});

		// Handle serving skin assets
		ipcMain.handle('get-skin-asset', async (_event, assetPath: string) => {
			try {
				// assetPath is something like "default/Graphics/7_chips.png"
				// __dirname in development points to src/main, in production to out/main
				// We want to get to packages/dtx-desktop/static/skin
				const fullPath = path.join(__dirname, '..', '..', 'static', 'skin', assetPath);

				// Check if file exists
				await fs.promises.access(fullPath);

				// Read the file and convert to base64 data URL
				const fileBuffer = await fs.promises.readFile(fullPath);
				const mimeType = assetPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
				const base64Data = fileBuffer.toString('base64');
				const dataUrl = `data:${mimeType};base64,${base64Data}`;

				return { success: true, dataUrl };
			} catch (error) {
				console.error('Error loading skin asset:', error);
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Unknown error'
				};
			}
		});

		// Handle parsing DTX files to extract metadata
		ipcMain.handle('parse-dtx-files', async (_event, folderPath: string) => {
			return await parseDtxFiles(folderPath);
		});

		// Handle session validation
		ipcMain.handle('validate-session', async (_event, sessionData) => {
			return await validateSession(sessionData);
		});

		// Handle getting current session
		ipcMain.handle('get-current-session', async () => {
			return getCurrentSession();
		});

		// Handle logout
		ipcMain.handle('logout-session', async () => {
			return await logoutSession();
		});

		// SimFile service handlers
		ipcMain.handle('fetch-user-simfiles', async () => {
			return await fetchUserSimFiles();
		});

		ipcMain.handle('get-preview-url', async (_event, simfileId: number) => {
			if (!Number.isSafeInteger(simfileId) || simfileId <= 0) {
				throw new Error(`Invalid simfileId: ${simfileId} must be a positive integer`);
			}
			return await getPreviewUrl(simfileId);
		});

		ipcMain.handle('get-sound-preview-url', async (_event, simfileId: number) => {
			if (!Number.isSafeInteger(simfileId) || simfileId <= 0) {
				throw new Error(`Invalid simfileId: ${simfileId} must be a positive integer`);
			}
			return await getSoundPreviewUrl(simfileId);
		});

		// Handle loading asset files from API
		ipcMain.handle('load-asset-files', async (_event, simfileId: string) => {
			try {
				// Return empty array for empty or invalid simfileId
				if (!simfileId || simfileId === '' || simfileId === '0') {
					return [];
				}
				const result = await getSimfileWithFiles(String(simfileId));
				if (!result.success) {
					console.error('API Error:', result.error);
					if (
						result.error.includes('NOT_FOUND') ||
						result.error.includes('Failed to list files')
					) {
						return [];
					}
					throw new Error(`Error fetching files: ${result.error}`);
				}
				return (result.data?.files ?? []).map(
					(file: { key: string; size: number; uploaded: string }) => ({
						fileName: file.key.split('/').pop() ?? file.key,
						size: file.size,
						lastModified: file.uploaded,
						key: file.key
					})
				);
			} catch (error) {
				console.error('Error loading asset files:', error);
				// Return empty array instead of throwing to prevent UI crashes
				return [];
			}
		});

		// Handle creating simfile record in database
		ipcMain.handle('create-simfile-record', async (_event, simfileData: CreateSimfileData) => {
			return await createSimfileRecord(simfileData);
		});

		ipcMain.handle('get-next-display-id', async () => {
			return await getNextDisplayId();
		});

		// Handle searching cloud songs for autocomplete
		ipcMain.handle(
			'search-cloud-songs',
			async (_event, { query, limit = 8, excludeLinkedSongIds = [] }) => {
				try {
					const result = await simfileSearch({
						query,
						limit,
						excludeIds:
							excludeLinkedSongIds.length > 0
								? excludeLinkedSongIds.map(String)
								: undefined
					});

					if (!result.success) {
						return { success: false, error: result.error };
					}

					// Map camelCase GraphQL response to snake_case shape the renderer expects
					const data = result.data.simfileSearch.map((s) => ({
						id: s.id,
						title: s.title,
						artist: s.artist,
						bpm: s.bpm,
						is_published: s.isPublished
					}));
					return { success: true, data };
				} catch (error) {
					console.error('Error searching cloud songs:', error);
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error'
					};
				}
			}
		);

		// Handle fetching cloud song data without file caching
		ipcMain.handle('fetch-cloud-song', async (_event, { cloudSongId }) => {
			try {
				const result = await getSimfile(String(cloudSongId));

				if (!result.success) {
					return { success: false, error: result.error };
				}

				if (!result.data.simfile) {
					return { success: false, error: 'Cloud song not found' };
				}

				const cloudSongData = toRendererSimfile(result.data.simfile);

				return {
					success: true,
					cloudSongData
				};
			} catch (error) {
				console.error('Error fetching cloud song data:', error);
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Unknown error'
				};
			}
		});

		// Map renderer snake_case keys to GraphQL camelCase keys
		const snakeToCamelMap: Record<string, string> = {
			display_id: 'displayId',
			publish_date: 'publishDate',
			is_published: 'isPublished',
			download_url: 'downloadUrl',
			video_preview_url: 'videoPreviewUrl',
			preview_url: 'previewUrl'
		};

		// Handle updating simfile record in database
		ipcMain.handle('update-simfile-record', async (_event, { simfileId, updateData }) => {
			try {
				// Convert snake_case keys from renderer to camelCase for GraphQL
				const converted: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(updateData as Record<string, unknown>)) {
					const camelKey = snakeToCamelMap[key] ?? key;
					converted[camelKey] = value;
				}
				const result = await updateSimfile(String(simfileId), converted);

				if (!result.success) {
					return { success: false, error: result.error };
				}

				const data = toRendererSimfile(result.data.updateSimfile);

				return { success: true, data };
			} catch (error) {
				console.error('Error updating simfile:', error);
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Unknown error'
				};
			}
		});

		// Handle exporting song folder to zip
		ipcMain.handle(
			'export-song-to-zip',
			async (_event, { songPath, songTitle, exportDirectory }) => {
				try {
					// Use provided export directory or default to Downloads
					let targetDirectory = exportDirectory;
					if (!targetDirectory || targetDirectory === '~/Downloads') {
						// Resolve the actual Downloads directory
						const os = await import('os');
						targetDirectory = path.join(os.homedir(), 'Downloads');
					} else if (targetDirectory.startsWith('~/')) {
						// Expand tilde to home directory
						const os = await import('os');
						targetDirectory = path.join(os.homedir(), targetDirectory.slice(2));
					}

					// Ensure the target directory exists
					try {
						await fs.promises.access(targetDirectory);
					} catch (error) {
						// Directory doesn't exist, try to create it
						try {
							await fs.promises.mkdir(targetDirectory, { recursive: true });
						} catch (mkdirError) {
							return {
								success: false,
								error: `Cannot access or create export directory: ${targetDirectory}`
							};
						}
					}

					const zipFileName = `${songTitle || 'song'}.zip`;
					const zipFilePath = path.join(targetDirectory, zipFileName);

					// Read all files in the song directory
					const entries = await fs.promises.readdir(songPath, { withFileTypes: true });

					// Filter for valid DTX-related file types (imported from common package)
					const validFiles = entries
						.filter((entry) => entry.isFile())
						.map((entry) => entry.name)
						.filter((fileName) => {
							const ext = path.extname(fileName).toLowerCase();
							return VALID_DTX_FILE_EXTENSIONS.includes(
								ext as (typeof VALID_DTX_FILE_EXTENSIONS)[number]
							);
						});

					if (validFiles.length === 0) {
						return { success: false, error: 'No valid files found to export' };
					}

					// Create zip using JSZip
					const JSZip = (await import('jszip')).default;
					const zip = new JSZip();

					// Add files to zip
					for (const fileName of validFiles) {
						const filePath = path.join(songPath, fileName);
						const fileBuffer = await fs.promises.readFile(filePath);
						zip.file(fileName, fileBuffer);
					}

					// Generate zip buffer
					const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

					// Write zip file to selected location
					await fs.promises.writeFile(zipFilePath, zipBuffer);

					return {
						success: true,
						zipPath: zipFilePath,
						filesCount: validFiles.length
					};
				} catch (error) {
					console.error('Error exporting song to zip:', error);
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error'
					};
				}
			}
		);

		// Handle file upload from desktop to cloud
		ipcMain.handle(
			'upload-file',
			async (_event, fileName: string, songFolderPath: string, simfileId: string) => {
				try {
					const filePath = path.join(songFolderPath, fileName);
					try {
						await fs.promises.access(filePath);
					} catch {
						throw new Error(`File not found: ${filePath}`);
					}
					const fileBuffer = await fs.promises.readFile(filePath);
					let fileNameWithoutDir = fileName;
					if (fileName.includes('/')) {
						fileNameWithoutDir = fileName.split('/').slice(1).join('/');
					}
					const formData = new FormData();
					formData.append('file', new File([fileBuffer], fileNameWithoutDir));
					formData.append('simFileId', simfileId);
					const result = await uploadFile(formData);
					if (!result.success) {
						throw new Error(`Upload failed: ${result.error}`);
					}
					return { success: true, data: result.data };
				} catch (error) {
					console.error('Error uploading file:', error);
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error'
					};
				}
			}
		);

		// Register custom protocol handler (dtx://)
		const PROTOCOL = 'dtx';

		if (!app.isDefaultProtocolClient(PROTOCOL)) {
			app.setAsDefaultProtocolClient(PROTOCOL);
		}

		// Handle protocol. This is called when your app is opened with the custom URL
		// macOS protocol handler
		app.on('open-url', (event, url) => {
			event.preventDefault();
			handleProtocolUrl(url);
		});

		// Windows protocol handler (for when app is not running)
		app.on('second-instance', (_, commandLine) => {
			// Someone tried to run a second instance, we should focus our window.
			if (BrowserWindow.getAllWindows().length > 0) {
				const mainWindow = BrowserWindow.getAllWindows()[0];
				if (mainWindow.isMinimized()) mainWindow.restore();
				mainWindow.focus();

				// Check if this is a protocol URL (Windows passes full command line)
				const protocolUrl = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
				if (protocolUrl) {
					handleProtocolUrl(protocolUrl);
				}
			}
		});

		createWindow();

		app.on('activate', function () {
			// On macOS it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	// Quit when all windows are closed, except on macOS. There, it's common
	// for applications and their menu bar to stay active until the user quits
	// explicitly with Cmd + Q.
	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			app.quit();
		}
	});
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
