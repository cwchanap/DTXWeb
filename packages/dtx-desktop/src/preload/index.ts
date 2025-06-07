import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// Custom APIs for renderer
const api = {
	// Auth-related methods will be exposed here
};

// Extend the electronAPI with our custom IPC handlers
const extendedElectronAPI = {
	...electronAPI,
	ipcRenderer: {
		...electronAPI.ipcRenderer,
		// Add our custom IPC handlers
		invoke: (channel: string, ...args: any[]) => {
			// Whitelist channels that can be invoked
			const validChannels = [
				'select-directory',
				'path-exists',
				'open-folder-in-explorer',
				'select-folder',
				'get-subdirectories',
				'create-directory',
				'write-file',
				'copy-directory-contents',
				'list-directories',
				'load-tree-structure',
				'read-file',
				'list-files',
				'verify-magic-link',
				'validate-session',
				'get-current-session',
				'logout-session',
				'fetch-user-simfiles',
				'get-preview-url',
				'get-sound-preview-url',
				'load-asset-files'
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
