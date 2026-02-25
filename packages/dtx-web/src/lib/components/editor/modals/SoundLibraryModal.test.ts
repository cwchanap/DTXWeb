import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import ModalStub from '../../../../tests/stubs/ModalStub.svelte';

const soundLibMock = vi.hoisted(() => ({
	getAll: vi.fn(() => [
		{
			hash: 'abc123',
			fileName: 'kick.wav',
			size: 1024,
			fileType: 'audio/wav',
			dateAdded: Date.now()
		},
		{
			hash: 'def456',
			fileName: 'snare.wav',
			size: 2048,
			fileType: 'audio/wav',
			dateAdded: Date.now()
		}
	]),
	getStats: vi.fn(() => ({ fileCount: 2, sizeFormatted: '3.0 KB' })),
	addFiles: vi.fn().mockResolvedValue({ added: 2, skipped: 0, errors: [] }),
	removeFile: vi.fn(),
	clear: vi.fn(),
	findByFileName: vi.fn(() => []),
	toFile: vi.fn(() => null)
}));

vi.mock('$lib/services/soundLibrary', () => ({
	SoundLibrary: soundLibMock
}));

vi.mock('@dtx/ui-components/components', () => ({
	Modal: ModalStub
}));

import SoundLibraryModal from './SoundLibraryModal.svelte';

const defaultProps = { show: true, onClose: vi.fn() };

describe('SoundLibraryModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		soundLibMock.getAll.mockReturnValue([
			{
				hash: 'abc123',
				fileName: 'kick.wav',
				size: 1024,
				fileType: 'audio/wav',
				dateAdded: Date.now()
			},
			{
				hash: 'def456',
				fileName: 'snare.wav',
				size: 2048,
				fileType: 'audio/wav',
				dateAdded: Date.now()
			}
		]);
		soundLibMock.getStats.mockReturnValue({ fileCount: 2, sizeFormatted: '3.0 KB' });
	});

	describe('Rendering', () => {
		it('renders the modal heading when show is true', () => {
			render(SoundLibraryModal, { props: defaultProps });
			expect(screen.getByText('Sound Files Library')).toBeInTheDocument();
		});

		it('does not render the modal when show is false', () => {
			render(SoundLibraryModal, { props: { ...defaultProps, show: false } });
			expect(screen.queryByText('Sound Files Library')).not.toBeInTheDocument();
		});

		it('displays library stats', () => {
			render(SoundLibraryModal, { props: defaultProps });
			expect(screen.getByText(/2 files, 3\.0 KB total/)).toBeInTheDocument();
		});

		it('renders file list with file names', () => {
			render(SoundLibraryModal, { props: defaultProps });
			expect(screen.getByText('kick.wav')).toBeInTheDocument();
			expect(screen.getByText('snare.wav')).toBeInTheDocument();
		});

		it('renders remove buttons for each file', () => {
			render(SoundLibraryModal, { props: defaultProps });
			const removeButtons = screen.getAllByRole('button', { name: 'Remove file' });
			expect(removeButtons).toHaveLength(2);
		});

		it('renders Add Files button', () => {
			render(SoundLibraryModal, { props: defaultProps });
			expect(screen.getByRole('button', { name: 'Add Files' })).toBeInTheDocument();
		});

		it('renders Clear All button when fileCount is greater than 0', () => {
			render(SoundLibraryModal, { props: defaultProps });
			expect(screen.getByRole('button', { name: 'Clear All' })).toBeInTheDocument();
		});

		it('does not render Clear All button when fileCount is 0', () => {
			soundLibMock.getStats.mockReturnValue({ fileCount: 0, sizeFormatted: '0 B' });
			soundLibMock.getAll.mockReturnValue([]);
			render(SoundLibraryModal, { props: defaultProps });
			expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
		});

		it('renders empty state message when no files', () => {
			soundLibMock.getAll.mockReturnValue([]);
			soundLibMock.getStats.mockReturnValue({ fileCount: 0, sizeFormatted: '0 B' });
			render(SoundLibraryModal, { props: defaultProps });
			expect(screen.getByText('No sound files in library')).toBeInTheDocument();
		});

		it('renders Close button in footer', () => {
			render(SoundLibraryModal, { props: defaultProps });
			expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
		});
	});

	describe('Remove file confirmation flow', () => {
		it('shows remove confirmation modal when remove button is clicked', async () => {
			render(SoundLibraryModal, { props: defaultProps });

			const removeButtons = screen.getAllByRole('button', { name: 'Remove file' });
			await fireEvent.click(removeButtons[0]);

			expect(screen.getByRole('dialog', { name: 'Remove File' })).toBeInTheDocument();
		});

		it('calls SoundLibrary.removeFile when confirmed', async () => {
			render(SoundLibraryModal, { props: defaultProps });

			const removeButtons = screen.getAllByRole('button', { name: 'Remove file' });
			await fireEvent.click(removeButtons[0]);

			const confirmButton = screen.getByRole('button', { name: 'Remove' });
			await fireEvent.click(confirmButton);

			expect(soundLibMock.removeFile).toHaveBeenCalledWith('abc123');
		});

		it('dismisses the remove confirm modal when Cancel is clicked', async () => {
			render(SoundLibraryModal, { props: defaultProps });

			const removeButtons = screen.getAllByRole('button', { name: 'Remove file' });
			await fireEvent.click(removeButtons[0]);

			const dialog = screen.getByRole('dialog', { name: 'Remove File' });
			expect(dialog).toBeInTheDocument();

			const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
			const dialogCancelButton = cancelButtons.find((btn) => dialog.contains(btn));
			expect(dialogCancelButton).toBeDefined();
			await fireEvent.click(dialogCancelButton!);

			expect(screen.queryByRole('dialog', { name: 'Remove File' })).not.toBeInTheDocument();
		});
	});

	describe('Clear All confirmation flow', () => {
		it('shows clear library confirmation modal when Clear All is clicked', async () => {
			render(SoundLibraryModal, { props: defaultProps });

			await fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));

			expect(screen.getByRole('dialog', { name: 'Clear Library' })).toBeInTheDocument();
		});

		it('calls SoundLibrary.clear when confirmed', async () => {
			render(SoundLibraryModal, { props: defaultProps });

			await fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));

			const dialog = screen.getByRole('dialog', { name: 'Clear Library' });
			await fireEvent.click(within(dialog).getByRole('button', { name: 'Clear All' }));

			expect(soundLibMock.clear).toHaveBeenCalledOnce();
		});

		it('dismisses the clear confirm modal when Cancel is clicked', async () => {
			render(SoundLibraryModal, { props: defaultProps });

			await fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));

			const dialog = screen.getByRole('dialog', { name: 'Clear Library' });
			await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

			expect(screen.queryByRole('dialog', { name: 'Clear Library' })).not.toBeInTheDocument();
		});
	});

	describe('Close button', () => {
		it('calls onClose when Close button is clicked', async () => {
			const onClose = vi.fn();
			render(SoundLibraryModal, { props: { ...defaultProps, onClose } });

			await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
			expect(onClose).toHaveBeenCalledOnce();
		});
	});
});
