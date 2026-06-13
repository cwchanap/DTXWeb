import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

const mockVersions = vi.hoisted(() => ({
	app: '1.0.0',
	tauri: '2'
}));

const mockDesktopHost = vi.hoisted(() => ({
	getVersions: vi.fn(() => ({
		app: mockVersions.app,
		tauri: mockVersions.tauri
	}))
}));

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

import VersionsModal from './VersionsModal.svelte';

describe('VersionsModal', () => {
	afterEach(() => {
		cleanup();
	});

	it('renders the info button', () => {
		render(VersionsModal);
		expect(
			screen.getByRole('button', { name: /Show application information/i })
		).toBeInTheDocument();
	});

	it('modal is initially closed', () => {
		render(VersionsModal);
		expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
	});

	it('opens modal when info button is clicked', async () => {
		render(VersionsModal);
		const infoBtn = screen.getByRole('button', { name: /Show application information/i });
		await fireEvent.click(infoBtn);
		expect(screen.getByTestId('modal')).toBeInTheDocument();
	});

	it('shows modal title when opened', async () => {
		render(VersionsModal);
		await fireEvent.click(
			screen.getByRole('button', { name: /Show application information/i })
		);
		expect(screen.getByText('Application Information')).toBeInTheDocument();
	});

	it('displays application version when modal is open', async () => {
		render(VersionsModal);
		await fireEvent.click(
			screen.getByRole('button', { name: /Show application information/i })
		);
		expect(screen.getByText(mockVersions.app)).toBeInTheDocument();
	});

	it('displays Tauri version when modal is open', async () => {
		render(VersionsModal);
		await fireEvent.click(
			screen.getByRole('button', { name: /Show application information/i })
		);
		expect(screen.getByText(mockVersions.tauri)).toBeInTheDocument();
	});

	it('displays version labels when modal is open', async () => {
		render(VersionsModal);
		await fireEvent.click(
			screen.getByRole('button', { name: /Show application information/i })
		);
		expect(screen.getByText('Application')).toBeInTheDocument();
		expect(screen.getByText('Tauri')).toBeInTheDocument();
	});

	it('closes modal when Close button is clicked', async () => {
		render(VersionsModal);
		await fireEvent.click(
			screen.getByRole('button', { name: /Show application information/i })
		);
		expect(screen.getByTestId('modal')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /Close/i }));
		expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
	});
});
