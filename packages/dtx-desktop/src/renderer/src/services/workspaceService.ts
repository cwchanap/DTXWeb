import { workspaceStore } from '../stores/workspaceStore';

export const workspaceService = {
	/**
	 * Opens a folder selection dialog and sets the selected path as the workspace
	 */
	selectWorkspace: async (): Promise<void> => {
		try {
			workspaceStore.setLoading(true);

			// Use Electron's ipcRenderer to open folder selection dialog
			console.log('Invoking select-directory dialog');
			const result = await window.electron.ipcRenderer.invoke('select-directory');
			console.log('Dialog result:', result);

			if (result.canceled) {
				console.log('Dialog was canceled');
				return;
			}

			const selectedPath = result.filePaths[0];
			console.log('Selected path:', selectedPath);
			workspaceStore.setPath(selectedPath);

			// Load folders in the selected directory
			await workspaceService.loadWorkspaceFolders();
		} catch (error) {
			console.error('Failed to select workspace:', error);
			workspaceStore.setError('Failed to select workspace directory');
		} finally {
			workspaceStore.setLoading(false);
		}
	},

	/**
	 * Loads the list of folders in the current workspace
	 */
	loadWorkspaceFolders: async (): Promise<void> => {
		try {
			// Get the current path from the store using a proper subscription
			let currentPath: string | null = null;
			const unsubscribe = workspaceStore.subscribe((state) => {
				currentPath = state.path;
			});
			unsubscribe(); // Unsubscribe immediately after getting the value

			console.log('Current workspace path:', currentPath);

			if (!currentPath) {
				workspaceStore.setFolders([]);
				return;
			}

			workspaceStore.setLoading(true);

			// Use Electron's ipcRenderer to get folders in the workspace
			console.log('Invoking list-directories with path:', currentPath);
			const folders = await window.electron.ipcRenderer.invoke(
				'list-directories',
				currentPath
			);
			console.log('Received folders from main process:', folders);
			workspaceStore.setFolders(folders);
		} catch (error) {
			console.error('Failed to load workspace folders:', error);
			workspaceStore.setError('Failed to load folders from workspace');
		} finally {
			workspaceStore.setLoading(false);
		}
	},

	/**
	 * Clears the current workspace selection
	 */
	clearWorkspace: (): void => {
		workspaceStore.clearWorkspace();
	}
};
