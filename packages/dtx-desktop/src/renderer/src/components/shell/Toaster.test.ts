import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { toastStore } from '../../stores/toastStore';
import { get } from 'svelte/store';

vi.mock('@lucide/svelte');

import Toaster from './Toaster.svelte';

describe('Toaster', () => {
	beforeEach(() => {
		toastStore.reset();
	});
	afterEach(() => cleanup());

	it('renders nothing when there are no toasts', () => {
		render(Toaster);
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('renders an error toast with role=alert', () => {
		toastStore.error('save failed');
		render(Toaster);
		expect(screen.getByRole('alert')).toHaveTextContent('save failed');
	});

	it('renders a success toast with role=status', () => {
		toastStore.success('exported ok');
		render(Toaster);
		expect(screen.getByRole('status')).toHaveTextContent('exported ok');
	});

	it('dismiss button removes the toast from the store', async () => {
		toastStore.error('boom');
		render(Toaster);
		const dismiss = screen.getByRole('button', { name: /dismiss/i });
		await fireEvent.click(dismiss);
		expect(get(toastStore)).toEqual([]);
	});
});
