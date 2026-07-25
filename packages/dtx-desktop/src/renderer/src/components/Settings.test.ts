import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { settingsStore } from '../stores/settingsStore';

vi.mock('@lucide/svelte');

const mockDesktopHost = vi.hoisted(() => ({
	selectFolder: vi.fn(),
	selectWorkspaceFolder: vi.fn(),
	getDefaultDownloadsDir: vi.fn(async () => '/Users/Test/Downloads')
}));

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

import SettingsComponent from './Settings.svelte';

describe('Settings', () => {
	beforeEach(async () => {
		await settingsStore.reset();
		vi.clearAllMocks();
		mockDesktopHost.selectFolder.mockResolvedValue({ canceled: true, filePaths: [] });
		mockDesktopHost.getDefaultDownloadsDir.mockResolvedValue('/Users/Test/Downloads');
	});

	afterEach(() => {
		cleanup();
	});

	it('renders Settings header', () => {
		render(SettingsComponent);
		expect(screen.getByText('Settings')).toBeInTheDocument();
	});

	it('renders Export Settings section', () => {
		render(SettingsComponent);
		expect(screen.getByText('Export Settings')).toBeInTheDocument();
	});

	it('renders Default Export Directory label', () => {
		render(SettingsComponent);
		expect(screen.getByText('Default Export Directory')).toBeInTheDocument();
	});

	it('shows current export directory from store', () => {
		settingsStore.updateExportDirectory('/custom/path');
		render(SettingsComponent);
		expect(screen.getByText('/custom/path')).toBeInTheDocument();
	});

	it('renders Browse button', () => {
		render(SettingsComponent);
		expect(screen.getByRole('button', { name: /Browse/i })).toBeInTheDocument();
	});

	it('renders Reset to Default button', () => {
		render(SettingsComponent);
		expect(screen.getByRole('button', { name: /Reset to Default/i })).toBeInTheDocument();
	});

	it('calls settingsStore.reset when Reset to Default is clicked', async () => {
		const resetSpy = vi.spyOn(settingsStore, 'reset');
		render(SettingsComponent);
		const resetBtn = screen.getByRole('button', { name: /Reset to Default/i });
		await fireEvent.click(resetBtn);
		expect(resetSpy).toHaveBeenCalled();
	});

	it('shows success message after reset', async () => {
		render(SettingsComponent);
		const resetBtn = screen.getByRole('button', { name: /Reset to Default/i });
		await fireEvent.click(resetBtn);
		expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument();
	});

	it('hides success message after 2 seconds', async () => {
		vi.useFakeTimers();
		try {
			render(SettingsComponent);
			const resetBtn = screen.getByRole('button', { name: /Reset to Default/i });
			await fireEvent.click(resetBtn);
			expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument();
			vi.advanceTimersByTime(2001);
			await waitFor(() => {
				expect(screen.queryByText('Settings saved successfully!')).not.toBeInTheDocument();
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('calls desktopHost.selectFolder when Browse button is clicked', async () => {
		mockDesktopHost.selectFolder.mockResolvedValue({ canceled: true, filePaths: [] });
		render(SettingsComponent);
		const browseBtn = screen.getByRole('button', { name: /Browse/i });
		await fireEvent.click(browseBtn);
		await waitFor(() => {
			expect(mockDesktopHost.selectFolder).toHaveBeenCalled();
		});
		expect(mockDesktopHost.selectWorkspaceFolder).not.toHaveBeenCalled();
	});

	it('updates export directory when folder is selected', async () => {
		mockDesktopHost.selectFolder.mockResolvedValue({
			canceled: false,
			filePaths: ['/new/export/path']
		});
		render(SettingsComponent);
		const browseBtn = screen.getByRole('button', { name: /Browse/i });
		await fireEvent.click(browseBtn);
		await waitFor(() => {
			expect(screen.getByText('/new/export/path')).toBeInTheDocument();
		});
	});
});
