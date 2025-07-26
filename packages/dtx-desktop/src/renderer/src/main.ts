import { mount } from 'svelte';
import init from 'xa_decoder';

import './assets/main.css';

import App from './App.svelte';

// Initialize WASM module for XA decoder
await init({});

const app = mount(App, {
	target: document.getElementById('app')!
});

export default app;
