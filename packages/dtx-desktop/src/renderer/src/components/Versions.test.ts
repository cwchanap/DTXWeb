import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

const mockDesktopHost = vi.hoisted(() => ({
	getVersions: vi.fn(() => ({
		app: '1.0.0',
		tauri: '2'
	}))
}));

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

import Versions from './Versions.svelte';

describe('Versions', () => {
	afterEach(() => {
		cleanup();
	});

	it('displays application version', () => {
		render(Versions);
		expect(screen.getByText('1.0.0')).toBeInTheDocument();
	});

	it('displays Tauri version', () => {
		render(Versions);
		expect(screen.getByText('2')).toBeInTheDocument();
	});

	it('displays version labels', () => {
		render(Versions);
		expect(screen.getByText('Application')).toBeInTheDocument();
		expect(screen.getByText('Tauri')).toBeInTheDocument();
	});
});
