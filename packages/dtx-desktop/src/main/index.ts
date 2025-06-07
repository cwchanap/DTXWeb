import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import fs from 'fs';
import {
	verifyMagicLink,
	validateSession,
	getCurrentSession,
	logoutSession,
	handleProtocolUrl
} from './auth';
import { fetchUserSimFiles, getPreviewUrl, getSoundPreviewUrl } from './simfile-service';
import { loadTreeStructure } from './filesystem';
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

		// Shared directory selection dialog logic
		const selectDirectory = async () => {
			const result = await dialog.showOpenDialog({
				properties: ['openDirectory']
			});
			return result;
		};

		// Handle directory selection dialog (workspace selection)
		ipcMain.handle('select-directory', selectDirectory);

		// Handle folder selection dialog (new song creation)
		ipcMain.handle('select-folder', selectDirectory);

		// Handle getting subdirectories (for new song creation)
		ipcMain.handle('get-subdirectories', async (_event, dirPath) => {
			try {
				console.log('Getting subdirectories in:', dirPath);
				const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

				// Filter only directories and return full paths
				const directories = entries
					.filter((entry) => entry.isDirectory())
					.map((dir) => `${dirPath}/${dir.name}`);

				console.log('Found subdirectories:', directories);
				return directories;
			} catch (error) {
				console.error('Error getting subdirectories:', error);
				return [];
			}
		});

		// Handle creating directory
		ipcMain.handle('create-directory', async (_event, dirPath) => {
			try {
				console.log('Creating directory:', dirPath);
				await fs.promises.mkdir(dirPath, { recursive: true });
				return { success: true };
			} catch (error) {
				console.error('Error creating directory:', error);
				throw error;
			}
		});

		// Handle writing file
		ipcMain.handle('write-file', async (_event, filePath, content) => {
			try {
				console.log('Writing file:', filePath);
				await fs.promises.writeFile(filePath, content, 'utf-8');
				return { success: true };
			} catch (error) {
				console.error('Error writing file:', error);
				throw error;
			}
		});

		// Handle listing directories in a path
		ipcMain.handle('list-directories', async (_event, dirPath) => {
			try {
				console.log('Listing directories in:', dirPath);
				const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

				// Filter only directories
				const directories = entries
					.filter((entry) => entry.isDirectory())
					.map((dir) => dir.name);

				console.log('Found directories:', directories);
				return directories;
			} catch (error) {
				console.error('Error listing directories:', error);
				return [];
			}
		});

		// Handle loading tree structure with lazy loading
		ipcMain.handle('load-tree-structure', async (_event, dirPath) => {
			return await loadTreeStructure(dirPath);
		});

		// Handle reading file contents
		ipcMain.handle('read-file', async (_event, filePath) => {
			try {
				const content = await fs.promises.readFile(filePath, 'utf-8');
				return content;
			} catch (error) {
				console.error('Error reading file:', error);
				throw error;
			}
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
							const filePath = `${dirPath}/${file.name}`;
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

		// Handle magic link verification in main process
		ipcMain.handle('verify-magic-link', async (_event, magicLinkUrl) => {
			return await verifyMagicLink(magicLinkUrl);
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
				const { getCurrentSession, getSupabaseClient } = await import('./auth');
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
