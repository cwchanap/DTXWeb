import { ElectronAPI } from '@electron-toolkit/preload';

declare global {
	interface Window {
		electron: ElectronAPI;
		api: {
			// Add any custom API methods here
		};
	}
}
