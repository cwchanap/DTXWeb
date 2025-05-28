import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { URL } from 'url';
import fs from 'fs';
import { SimFile } from '@dtx/common';

function createWindow(): void {
	// Create the browser window.
	const mainWindow = new BrowserWindow({
		width: 900,
		height: 670,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(__dirname, '../preload/index.js'),
			sandbox: false
		}
	});

	mainWindow.on('ready-to-show', () => {
		mainWindow.show();
	});

	mainWindow.webContents.setWindowOpenHandler((details) => {
		shell.openExternal(details.url);
		return { action: 'deny' };
	});

	// HMR for renderer base on electron-vite cli.
	// Load the remote URL for development or the local html file for production.
	if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
		mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
	} else {
		mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
	}
}

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

		// Handle directory selection dialog
		ipcMain.handle('select-directory', async () => {
			const result = await dialog.showOpenDialog({
				properties: ['openDirectory']
			});
			return result;
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
			try {
				console.log('Loading tree structure for:', dirPath);
				const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

				// Filter only directories and create tree nodes
				const allDirectories = entries.filter((entry) => entry.isDirectory());

				const treeNodes = await Promise.all(
					allDirectories.map(async (dir) => {
						const fullPath = `${dirPath}/${dir.name}`;

						// Check if directory has subdirectories
						let hasChildren = false;
						let containsDtxFiles = false;
						let songTitle: string | null = null;

						try {
							const subEntries = await fs.promises.readdir(fullPath, {
								withFileTypes: true
							});

							// Check for subdirectories
							hasChildren = subEntries.some((entry) => entry.isDirectory());

							// Check for .dtx files
							containsDtxFiles = subEntries.some(
								(entry) =>
									entry.isFile() && entry.name.toLowerCase().endsWith('.dtx')
							);

							// If folder contains .dtx files, check for SET.def and read song title
							if (containsDtxFiles) {
								const setDefFile = subEntries.find(
									(entry) =>
										entry.isFile() && entry.name.toLowerCase() === 'set.def'
								);

								if (setDefFile) {
									try {
										const setDefPath = `${fullPath}/${setDefFile.name}`;
										// Read as buffer to preserve original encoding
										const setDefBuffer = await fs.promises.readFile(setDefPath);

										// Create a File object from the buffer to use with SimFile
										const file = new File([setDefBuffer], 'set.def');
										const simFile = new SimFile([file]);
										await simFile.parseHeader(file);
										songTitle = simFile.title || null;
										console.log('Song title:', songTitle);
									} catch (error) {
										console.warn('Could not read SET.def file:', error);
									}
								}
							}
						} catch (error) {
							console.warn('Could not check subdirectories for:', fullPath);
						}

						return {
							name: dir.name,
							path: fullPath,
							isExpanded: false,
							isLoading: false,
							children: [],
							hasChildren: containsDtxFiles ? false : hasChildren, // Don't show children for folders with .dtx files
							containsDtxFiles,
							songTitle
						};
					})
				);

				// Filter nodes: show DTXFiles folders and folders containing .dtx files
				const filteredNodes = treeNodes.filter(
					(node) => node.name.startsWith('DTXFiles.') || node.containsDtxFiles
				);

				return filteredNodes;
			} catch (error) {
				console.error('Error loading tree structure:', error);
				return [];
			}
		});

		// Handle reading file contents
		ipcMain.handle('read-file', async (_event, filePath) => {
			try {
				console.log('Reading file:', filePath);
				const content = await fs.promises.readFile(filePath, 'utf-8');
				return content;
			} catch (error) {
				console.error('Error reading file:', error);
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

		// Helper function to handle protocol URLs
		function handleProtocolUrl(url: string) {
			try {
				const parsedUrl = new URL(url);

				if (parsedUrl.hostname === 'auth-callback') {
					// Extract token from URL query parameters
					const token = parsedUrl.searchParams.get('token');

					if (token && BrowserWindow.getAllWindows().length > 0) {
						// Get main window
						const mainWindow = BrowserWindow.getAllWindows()[0];

						// Send the token to the renderer process
						mainWindow.webContents.send('auth-callback', token);
					}
				}
			} catch (error) {
				console.error('Failed to parse protocol URL:', error);
			}
		}

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
