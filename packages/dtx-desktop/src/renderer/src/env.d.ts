/// <reference types="svelte" />
/// <reference types="vite/client" />

declare global {
	interface ImportMetaEnv {
		readonly VITE_DTX_API_URL: string;
		readonly PUBLIC_SIMFILE_BUCKET_URL: string;
		readonly VITE_WDIO?: string;
		// more env variables...
	}

	interface Window {
		__TAURI__?: unknown;
	}
}

export {};
