import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

vi.mock('@lucide/svelte', () => ({
	Zap: vi.fn(),
	Chrome: vi.fn(),
	Server: vi.fn()
}));

import Versions from './Versions.svelte';

describe('Versions', () => {
	beforeEach(() => {
		Object.defineProperty(window, 'electron', {
			configurable: true,
			writable: true,
			value: {
				ipcRenderer: { send: vi.fn(), on: vi.fn(), invoke: vi.fn() },
				process: {
					versions: {
						electron: '35.0.0',
						chrome: '130.0.0',
						node: '20.0.0'
					}
				}
			}
		});
	});

	afterEach(() => {
		cleanup();
	});

	it('displays electron version', () => {
		render(Versions);
		expect(screen.getByText('35.0.0')).toBeInTheDocument();
	});

	it('displays chrome version', () => {
		render(Versions);
		expect(screen.getByText('130.0.0')).toBeInTheDocument();
	});

	it('displays node version', () => {
		render(Versions);
		expect(screen.getByText('20.0.0')).toBeInTheDocument();
	});

	it('displays version labels', () => {
		render(Versions);
		expect(screen.getByText('Electron')).toBeInTheDocument();
		expect(screen.getByText('Chromium')).toBeInTheDocument();
		expect(screen.getByText('Node.js')).toBeInTheDocument();
	});
});
