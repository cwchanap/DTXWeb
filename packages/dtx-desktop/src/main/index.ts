import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import fs from 'fs';
import path from 'path';
import { SimFile, DTXFile, decodeFileWithEncodingDetection } from '@dtx/common';
import {
	validateSession,
	getCurrentSession,
	logoutSession,
	handleProtocolUrl,
	getSupabaseClient
} from './auth';
import {
	fetchUserSimFiles,
	getPreviewUrl,
	getSoundPreviewUrl,
	createSimfileRecord,
	CreateSimfileData
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
		electronApp.setAppUserModelId('com.electron');

		// Default open or close DevTools by F12 in development
		// and ignore CommandOrControl + R in production.
		// see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
		app.on('browser-window-created', (_, window) => {
			optimizer.watchWindowShortcuts(window);
		});

		// IPC test
		ipcMain.on('ping', () => console.log('pong'));

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
				return true;
			} catch (error) {
				return false;
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

				console.log('Creating song:', {
					selectedPath,
					sanitizedFolderName,
					sanitizedSongName,
					templateFolderPath
				});

				// Check if folder already exists
				const songFolderPath = path.join(selectedPath, sanitizedFolderName);
				try {
					await fs.promises.access(songFolderPath);
					throw new Error(
						`A folder named "${sanitizedFolderName}" already exists in the selected location`
					);
				} catch (accessError: any) {
					// If the error is NOT ENOENT, it means something else went wrong
					if (accessError.code !== 'ENOENT') {
						throw accessError;
					}
					// ENOENT means the folder doesn't exist, which is what we want
				}

				// Create the song folder
				console.log('Creating song folder at:', songFolderPath);
				await fs.promises.mkdir(songFolderPath, { recursive: true });

				// If a template is provided, copy its contents to the new folder
				if (templateFolderPath) {
					console.log(
						'Copying template files from:',
						templateFolderPath,
						'to:',
						songFolderPath
					);

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
					console.log('Template files copied successfully');
				} else {
					console.log('No template provided, creating empty song folder');
				}

				// Create SET.def file using SimFile's generateDefFileContent method
				const simFile = new SimFile([]); // Empty files array for new SimFile
				simFile.title = sanitizedSongName;

				const setDefPath = path.join(songFolderPath, 'SET.def');
				const setDefContent = simFile.generateDefFileContent();

				// Write the SET.def file (this will overwrite template's SET.def if it exists)
				console.log('Writing SET.def file to:', setDefPath);

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
				console.log('Listing files in:', dirPath);
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

		// Handle parsing DTX files to extract metadata
		ipcMain.handle('parse-dtx-files', async (_event, folderPath: string) => {
			try {
				console.log('Parsing DTX files in folder:', folderPath);

				// Get all DTX files in the folder
				const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
				const dtxFiles = entries
					.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.dtx'))
					.map((entry) => entry.name);

				console.log('Found DTX files:', dtxFiles);

				if (dtxFiles.length === 0) {
					return {
						bpm: undefined,
						artist: undefined,
						levels: []
					};
				}

				let parsedBpm: number | undefined;
				let parsedArtist: string | undefined;
				const parsedLevels: { label: string; level: number }[] = [];

				// Parse each DTX file
				for (const fileName of dtxFiles) {
					try {
						const filePath = path.join(folderPath, fileName);
						const fileBuffer = await fs.promises.readFile(filePath);

						// Create a temporary File object from the buffer for the utility function
						const tempFile = new File([fileBuffer], fileName);

						// DTX file validation callback
						const validateDtxContent = (content: string): boolean => {
							return (
								content.includes('#TITLE:') ||
								content.includes('#ARTIST:') ||
								content.includes('#BPM:') ||
								content.includes('#WAV')
							);
						};

						const fileContent = await decodeFileWithEncodingDetection(
							tempFile,
							validateDtxContent,
							['shift-jis', 'utf-8', 'utf-16le', 'utf-16be'],
							'shift-jis'
						);

						const dtx = new DTXFile(fileContent);
						await dtx.parse();

						console.log(`Parsed DTX file ${fileName}:`, {
							title: dtx.title,
							artist: dtx.artist,
							level: dtx.level,
							bpm: dtx.bpm
						});

						// Use the first valid parsed values
						if (!parsedBpm && dtx.bpm) {
							parsedBpm = dtx.bpm;
						}
						if (!parsedArtist && dtx.artist) {
							parsedArtist = dtx.artist;
						}

						// Add level information
						if (dtx.level) {
							parsedLevels.push({
								label: dtx.difficulty || fileName.replace('.dtx', ''),
								level: dtx.level
							});
						}
					} catch (error) {
						console.warn(`Failed to parse DTX file ${fileName}:`, error);
						continue;
					}
				}

				const result = {
					bpm: parsedBpm,
					artist: parsedArtist,
					levels: parsedLevels
				};

				console.log('Parsed DTX metadata:', result);
				return result;
			} catch (error) {
				console.error('Error parsing DTX files:', error);
				return {
					bpm: undefined,
					artist: undefined,
					levels: []
				};
			}
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

		ipcMain.handle('get-preview-url', async (_event, preview_url: string) => {
			return getPreviewUrl(preview_url);
		});

		ipcMain.handle(
			'get-sound-preview-url',
			async (_event, sound_preview_url: string | null) => {
				return getSoundPreviewUrl(sound_preview_url);
			}
		);

		// Handle loading asset files from API
		ipcMain.handle('load-asset-files', async (_event, simfileId: string) => {
			try {
				const apiBaseUrl = import.meta.env.VITE_DTX_SERVER_URL || '';
				if (!apiBaseUrl) {
					throw new Error('VITE_DTX_SERVER_URL environment variable is not set');
				}

				// Get the current session to extract JWT token
				const session = getCurrentSession();
				const supabaseClient = getSupabaseClient();

				if (!session || !supabaseClient) {
					throw new Error('User not authenticated');
				}

				// Get fresh session to ensure token is valid
				const {
					data: { session: currentSession },
					error: sessionError
				} = await supabaseClient.auth.getSession();

				if (sessionError || !currentSession) {
					throw new Error('Failed to get valid session');
				}

				const url = `${apiBaseUrl}/api/simFile/listFiles/${simfileId}`;
				console.log('Fetching asset files from:', url);

				// Create session cookies that SvelteKit expects
				const sessionCookies = [
					`sb-hdnwvpusmxrfrfjayogr-auth-token=${JSON.stringify({
						access_token: currentSession.access_token,
						refresh_token: currentSession.refresh_token,
						expires_at: currentSession.expires_at,
						expires_in: currentSession.expires_in,
						token_type: currentSession.token_type,
						user: currentSession.user
					})}; Path=/; HttpOnly; SameSite=Lax`
				];

				const response = await fetch(url, {
					headers: {
						Cookie: sessionCookies.join('; '),
						'Content-Type': 'application/json'
					}
				});

				if (!response.ok) {
					const errorText = await response.text();
					console.error('API Error Response:', errorText);
					throw new Error(`Error fetching files: ${response.statusText} - ${errorText}`);
				}

				const data = await response.json();
				return data.files;
			} catch (error) {
				console.error('Error loading asset files:', error);
				throw error;
			}
		});

		// Handle creating simfile record in database
		ipcMain.handle('create-simfile-record', async (_event, simfileData: CreateSimfileData) => {
			return await createSimfileRecord(simfileData);
		});

		// Handle file upload from desktop to cloud
		ipcMain.handle(
			'upload-file',
			async (_event, fileName: string, songFolderPath: string, simfileId: string) => {
				try {
					// Construct the full file path
					const filePath = path.join(songFolderPath, fileName);

					console.log(
						'Uploading file:',
						fileName,
						'from path:',
						filePath,
						'to simfile:',
						simfileId
					);

					// Check if file exists
					try {
						await fs.promises.access(filePath);
					} catch (error) {
						throw new Error(`File not found: ${filePath}`);
					}

					// Get the current session to extract JWT token
					const session = getCurrentSession();
					const supabaseClient = getSupabaseClient();

					if (!session || !supabaseClient) {
						throw new Error('User not authenticated');
					}

					// Get fresh session to ensure token is valid
					const {
						data: { session: currentSession },
						error: sessionError
					} = await supabaseClient.auth.getSession();

					if (sessionError || !currentSession) {
						throw new Error('Failed to get valid session');
					}

					// Read the file from local filesystem
					const fileBuffer = await fs.promises.readFile(filePath);

					// Create a blob from the buffer
					const blob = new Blob([fileBuffer]);

					// Remove the first level directory name if present
					let fileNameWithoutDir = fileName;
					if (fileName.includes('/')) {
						fileNameWithoutDir = fileName.split('/').slice(1).join('/');
					}

					// Create form data for the API
					const formData = new FormData();
					formData.append('file', blob, fileNameWithoutDir);
					formData.append('simFileId', simfileId);

					// Use Cloudflare Worker URL for uploads
					const workerUrl = import.meta.env.PUBLIC_CLOUDFARE_WORKER_URL || '';
					if (!workerUrl) {
						throw new Error(
							'PUBLIC_CLOUDFARE_WORKER_URL environment variable is not set'
						);
					}

					const url = `${workerUrl}/api/simFile/upload`;
					console.log('Uploading to:', url);

					// Send the request
					const response = await fetch(url, {
						method: 'POST',
						body: formData,
						headers: {
							Authorization: `Bearer ${currentSession.access_token}`
						}
					});

					if (!response.ok) {
						const errorText = await response.text();
						console.error('Upload Error Response:', errorText);
						throw new Error(`Upload failed: ${response.statusText} - ${errorText}`);
					}

					const result = await response.json();
					console.log('Upload successful:', result);
					return { success: true, data: result };
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
