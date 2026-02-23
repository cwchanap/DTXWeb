import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DiscardModal from './DiscardModal.svelte';

describe('DiscardModal', () => {
	const defaultProps = {
		show: true,
		chartName: 'My Song',
		difficultyText: ' (Basic)',
		onConfirm: vi.fn(),
		onCancel: vi.fn()
	};

	describe('Rendering', () => {
		it('renders when show is true', () => {
			render(DiscardModal, { props: defaultProps });
			expect(screen.getByText('Discard Local Changes?')).toBeInTheDocument();
		});

		it('does not render when show is false', () => {
			render(DiscardModal, { props: { ...defaultProps, show: false } });
			expect(screen.queryByText('Discard Local Changes?')).not.toBeInTheDocument();
		});

		it('displays chartName and difficultyText in the body', () => {
			render(DiscardModal, { props: defaultProps });
			expect(screen.getByText(/My Song/)).toBeInTheDocument();
			expect(screen.getByText(/ \(Basic\)/)).toBeInTheDocument();
		});

		it('shows the irreversible warning', () => {
			render(DiscardModal, { props: defaultProps });
			expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
		});
	});

	describe('Event handling', () => {
		it('calls onConfirm when Discard Changes button is clicked', async () => {
			const onConfirm = vi.fn();
			render(DiscardModal, { props: { ...defaultProps, onConfirm } });
			await fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
			expect(onConfirm).toHaveBeenCalledOnce();
		});

		it('calls onCancel when Cancel button is clicked', async () => {
			const onCancel = vi.fn();
			render(DiscardModal, { props: { ...defaultProps, onCancel } });
			await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
			expect(onCancel).toHaveBeenCalledOnce();
		});

		it('calls onCancel when Escape key is pressed', async () => {
			const onCancel = vi.fn();
			render(DiscardModal, { props: { ...defaultProps, onCancel } });
			const dialog = screen.getByRole('dialog');
			await fireEvent.keyDown(dialog, { key: 'Escape' });
			expect(onCancel).toHaveBeenCalledOnce();
		});
	});
});
