import { mount } from 'svelte';
import init from 'xa_decoder';

import './assets/main.css';

import App from './App.svelte';

// Initialize XA decoder WASM module
async function initializeApp() {
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
