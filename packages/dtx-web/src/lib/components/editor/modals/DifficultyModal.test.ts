/**
 * Unit tests for DifficultyModal component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DifficultyModal from './DifficultyModal.svelte';

describe('DifficultyModal Component', () => {
	const mockAvailableLevels = [
		{ level: 25, label: 'Basic', isActive: false },
		{ level: 50, label: 'Advanced', isActive: true },
		{ level: 75, label: 'Extreme', isActive: false }
	];

	describe('Rendering', () => {
		it('should render modal when show is true', () => {
			render(DifficultyModal, {
				props: {
					show: true,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: vi.fn(),
					onClose: vi.fn()
				}
			});

			expect(screen.getByText('Switch Difficulty')).toBeInTheDocument();
		});

		it('should not render modal when show is false', () => {
			render(DifficultyModal, {
				props: {
					show: false,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: vi.fn(),
					onClose: vi.fn()
				}
			});

			expect(screen.queryByText('Switch Difficulty')).not.toBeInTheDocument();
		});

		it('should render all available levels', () => {
			render(DifficultyModal, {
				props: {
					show: true,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: vi.fn(),
					onClose: vi.fn()
				}
			});

			expect(screen.getByText('Basic')).toBeInTheDocument();
			expect(screen.getByText('Advanced')).toBeInTheDocument();
			expect(screen.getByText('Extreme')).toBeInTheDocument();
			expect(screen.getByText('Level 25')).toBeInTheDocument();
			expect(screen.getByText('Level 50')).toBeInTheDocument();
			expect(screen.getByText('Level 75')).toBeInTheDocument();
		});

		it('should show current level indicator', () => {
			render(DifficultyModal, {
				props: {
					show: true,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: vi.fn(),
					onClose: vi.fn()
				}
			});

			expect(screen.getByText('Current')).toBeInTheDocument();
		});

		it('should disable button for active level', () => {
			render(DifficultyModal, {
				props: {
					show: true,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: vi.fn(),
					onClose: vi.fn()
				}
			});

			const advancedButton = screen.getByRole('button', { name: /Advanced/ });
			expect(advancedButton).toBeDisabled();
		});
	});

	describe('Event Handling', () => {
		it('should call onSwitchLevel when level button is clicked', async () => {
			const mockOnSwitchLevel = vi.fn();

			render(DifficultyModal, {
				props: {
					show: true,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: mockOnSwitchLevel,
					onClose: vi.fn()
				}
			});

			const basicButton = screen.getByRole('button', { name: /Basic/ });
			await fireEvent.click(basicButton);

			expect(mockOnSwitchLevel).toHaveBeenCalledWith(25);
		});

		it('should call onClose when Cancel button is clicked', async () => {
			const mockOnClose = vi.fn();

			render(DifficultyModal, {
				props: {
					show: true,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: vi.fn(),
					onClose: mockOnClose
				}
			});

			const cancelButton = screen.getByRole('button', { name: 'Cancel' });
			await fireEvent.click(cancelButton);

			expect(mockOnClose).toHaveBeenCalled();
		});

		it('should not call onSwitchLevel when disabled button is clicked', async () => {
			const mockOnSwitchLevel = vi.fn();

			render(DifficultyModal, {
				props: {
					show: true,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: mockOnSwitchLevel,
					onClose: vi.fn()
				}
			});

			const advancedButton = screen.getByRole('button', { name: /Advanced/ });
			await fireEvent.click(advancedButton);

			expect(mockOnSwitchLevel).not.toHaveBeenCalled();
		});
	});

	describe('Styling', () => {
		it('should apply active styles to current level', () => {
			render(DifficultyModal, {
				props: {
					show: true,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: vi.fn(),
					onClose: vi.fn()
				}
			});

			const advancedButton = screen.getByRole('button', { name: /Advanced/ });
			expect(advancedButton).toHaveClass('border-blue-500', 'bg-blue-50', 'text-blue-700');
		});

		it('should apply default styles to inactive levels', () => {
			render(DifficultyModal, {
				props: {
					show: true,
					availableLevels: mockAvailableLevels,
					onSwitchLevel: vi.fn(),
					onClose: vi.fn()
				}
			});

			const basicButton = screen.getByRole('button', { name: /Basic/ });
			expect(basicButton).toHaveClass('border-gray-300');
		});
	});
});
