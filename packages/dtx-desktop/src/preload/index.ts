import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// Custom APIs for renderer
const api = {
	// Auth-related methods will be exposed here
};

// Extend the electronAPI with our custom IPC handlers
const extendedElectronAPI = {
	...electronAPI,
	process: {
		env: process.env,
		platform: process.platform
	},
	ipcRenderer: {
		...electronAPI.ipcRenderer,
		// Add our custom IPC handlers
		invoke: (channel: string, ...args: any[]) => {
			// Whitelist channels that can be invoked
			const validChannels = [
				'select-folder',
				'path-exists',
				'open-folder-in-explorer',
				'load-tree-structure',
				'list-files',
				'read-file',
				'parse-dtx-files',
				'validate-session',
				'get-current-session',
				'logout-session',
				'fetch-user-simfiles',
				'get-preview-url',
				'get-sound-preview-url',
				'load-asset-files',
				'create-song',
				'create-simfile-record',
				'upload-file',
				'search-cloud-songs',
				'fetch-cloud-song',
				'update-simfile-record',
				'export-song-to-zip'
			];
			if (validChannels.includes(channel)) {
				return ipcRenderer.invoke(channel, ...args);
			}

			throw new Error(`Unauthorized IPC channel: ${channel}`);
		}
	}
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld('electron', extendedElectronAPI);
		contextBridge.exposeInMainWorld('api', api);
	} catch (error) {
		console.error(error);
	}
} else {
	// @ts-ignore (define in dts)
	window.electron = extendedElectronAPI;
	// @ts-ignore (define in dts)
	window.api = api;
}
