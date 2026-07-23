import { mount } from 'svelte';
import init from 'xa_decoder';

import './assets/main.css';
import './lib/i18n';

// Self-hosted fonts (bundled woff2 — CSP-safe, no Google CDN)
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/martian-mono/400.css';
import '@fontsource/martian-mono/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';

import App from './App.svelte';

// Initialize XA decoder WASM module
async function initializeApp() {
	if (import.meta.env.VITE_WDIO === 'true') {
		await import('@wdio/tauri-plugin');
	}

	// Ensure dark mode is enabled for TailwindCSS
	document.documentElement.classList.add('dark');

	try {
		if (import.meta.env.DEV) {
			console.log('[App] Starting XA decoder initialization...');
		}
		await init({});
		if (import.meta.env.DEV) {
			console.log('[App] XA decoder initialized successfully');
		}

		// Test if WasmXADecoder is available after init
		const { WasmXADecoder } = await import('xa_decoder');
		if (import.meta.env.DEV) {
			console.log('[App] WasmXADecoder availability:', typeof WasmXADecoder !== 'undefined');
		}

		if (typeof WasmXADecoder === 'undefined') {
			console.warn('[App] WasmXADecoder is still undefined after initialization');
		}
	} catch (error) {
		console.error('[App] Failed to initialize XA decoder:', error);
	}

	const app = mount(App, {
		target: document.getElementById('app')!
	});

	return app;
}

export default initializeApp();
