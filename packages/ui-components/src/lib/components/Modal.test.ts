import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Modal from './Modal.svelte';

describe('Modal', () => {
	describe('visibility', () => {
		it('renders content when open is true', () => {
			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {}
				}
			});

			expect(screen.getByRole('dialog')).toBeInTheDocument();
			expect(screen.getByText('Test Modal')).toBeInTheDocument();
		});

		it('does not render when open is false', () => {
			render(Modal, {
				props: {
					open: false,
					title: 'Test Modal',
					children: () => {}
				}
			});

			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});
	});

	describe('close button', () => {
		it('closes the modal when the X button is clicked', async () => {
			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {}
				}
			});

			await fireEvent.click(screen.getByLabelText('Close modal'));

			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});
	});

	describe('Escape key', () => {
		it('closes the modal when Escape is pressed', async () => {
			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {}
				}
			});

			await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});

		it('does not close when a non-Escape key is pressed', async () => {
			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {}
				}
			});

			await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

			expect(screen.getByRole('dialog')).toBeInTheDocument();
		});
	});

	describe('backdrop click', () => {
		it('closes the modal when backdrop is clicked directly', async () => {
			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {}
				}
			});

			const backdrop = screen.getByRole('dialog');
			await fireEvent.click(backdrop, { target: backdrop, currentTarget: backdrop });

			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});
	});

	describe('confirm button', () => {
		it('shows cancel and confirm buttons when onConfirm is provided', () => {
			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {},
					onConfirm: vi.fn()
				}
			});

			expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
		});

		it('does not show confirm/cancel buttons when onConfirm is not provided', () => {
			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {}
				}
			});

			expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
		});

		it('calls onConfirm and closes modal when confirm button is clicked', async () => {
			const onConfirm = vi.fn();

			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {},
					onConfirm
				}
			});

			await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

			expect(onConfirm).toHaveBeenCalledOnce();
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});

		it('closes modal when cancel button is clicked without calling onConfirm', async () => {
			const onConfirm = vi.fn();

			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {},
					onConfirm
				}
			});

			await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

			expect(onConfirm).not.toHaveBeenCalled();
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});

		it('uses custom confirmText and cancelText', () => {
			render(Modal, {
				props: {
					open: true,
					title: 'Test Modal',
					children: () => {},
					onConfirm: vi.fn(),
					confirmText: 'Delete',
					cancelText: 'Go back'
				}
			});

			expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
		});
	});

	describe('size prop', () => {
		it('applies sm size class', () => {
			render(Modal, {
				props: { open: true, title: 'T', children: () => {}, size: 'sm' }
			});

			const inner = screen.getByRole('dialog').querySelector('div');
			expect(inner?.className).toContain('max-w-sm');
		});

		it('applies lg size class', () => {
			render(Modal, {
				props: { open: true, title: 'T', children: () => {}, size: 'lg' }
			});

			const inner = screen.getByRole('dialog').querySelector('div');
			expect(inner?.className).toContain('max-w-lg');
		});
	});

	describe('confirmVariant prop', () => {
		it('applies danger variant class to confirm button', () => {
			render(Modal, {
				props: {
					open: true,
					title: 'T',
					children: () => {},
					onConfirm: vi.fn(),
					confirmVariant: 'danger'
				}
			});

			const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
			expect(confirmBtn.className).toContain('bg-red-600');
		});

		it('applies primary variant class to confirm button by default', () => {
			render(Modal, {
				props: {
					open: true,
					title: 'T',
					children: () => {},
					onConfirm: vi.fn()
				}
			});

			const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
			expect(confirmBtn.className).toContain('bg-blue-600');
		});
	});
});
