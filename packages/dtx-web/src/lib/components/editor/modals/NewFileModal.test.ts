import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import ModalStub from '../../../../tests/stubs/ModalStub.svelte';

vi.mock('@dtx/ui-components/components', () => ({
	Modal: ModalStub
}));

import NewFileModal from './NewFileModal.svelte';

describe('NewFileModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('renders warning content when show is true', () => {
		render(NewFileModal, {
			props: { show: true, onConfirm: vi.fn() }
		});
		expect(
			screen.getByText(/Creating a new file will clear all unsaved changes/i)
		).toBeInTheDocument();
		expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
	});

	it('does not render when show is false', () => {
		render(NewFileModal, {
			props: { show: false, onConfirm: vi.fn() }
		});
		expect(screen.queryByText(/Creating a new file/i)).not.toBeInTheDocument();
	});

	it('calls onConfirm when confirm button is clicked', async () => {
		const onConfirm = vi.fn();
		render(NewFileModal, { props: { show: true, onConfirm } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create New' }));
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it('calls onCancel when the modal is closed via Cancel button', async () => {
		const onCancel = vi.fn();
		render(NewFileModal, { props: { show: true, onConfirm: vi.fn(), onCancel } });
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it('does not call onCancel after confirm', async () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		render(NewFileModal, { props: { show: true, onConfirm, onCancel } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create New' }));
		expect(onConfirm).toHaveBeenCalledOnce();
		expect(onCancel).not.toHaveBeenCalled();
	});
});
