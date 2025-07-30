import { BrowserWindow, shell, app } from 'electron';
import { join } from 'path';

export function createWindow(): void {
	// Create the browser window.
	const mainWindow = new BrowserWindow({
		width: 900,
		height: 670,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(__dirname, '../preload/index'),
			sandbox: false,
			// Enable dev tools in production builds
			devTools: true
		}
	});

	mainWindow.on('ready-to-show', () => {
		mainWindow.show();
	});

	mainWindow.webContents.setWindowOpenHandler((details) => {
		shell.openExternal(details.url);
		return { action: 'deny' };
	});

	// Enable dev tools keyboard shortcuts in both development and production
	mainWindow.webContents.on('before-input-event', (_, input) => {
		// F12 to toggle dev tools
		if (input.key === 'F12') {
			if (mainWindow.webContents.isDevToolsOpened()) {
				mainWindow.webContents.closeDevTools();
			} else {
				mainWindow.webContents.openDevTools();
			}
		}
		// Ctrl+Shift+I (or Cmd+Option+I on Mac) to toggle dev tools
		else if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
			if (mainWindow.webContents.isDevToolsOpened()) {
				mainWindow.webContents.closeDevTools();
			} else {
				mainWindow.webContents.openDevTools();
			}
		}
	});

	// HMR for renderer base on electron-vite cli.
	// Load the remote URL for development or the local html file for production.
	const isDev = !app.isPackaged;
	if (isDev && process.env['ELECTRON_RENDERER_URL']) {
		mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
	} else {
		mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
	}
}
