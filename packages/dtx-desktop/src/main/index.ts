import { app, shell, BrowserWindow, ipcMain, protocol } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { URL } from 'url';

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
		app.on('second-instance', (event, commandLine) => {
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
