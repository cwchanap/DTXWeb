import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

vi.mock('@lucide/svelte/icons');

import EditorTips from './EditorTips.svelte';

describe('EditorTips', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('renders tip content when showTips is true', () => {
		render(EditorTips, { props: { showTips: true } });
		expect(screen.getByText(/Editor Tips/)).toBeInTheDocument();
	});

	it('does not render tips when showTips is false', () => {
		render(EditorTips, { props: { showTips: false } });
		expect(screen.queryByText(/Editor Tips/)).not.toBeInTheDocument();
	});

	it('shows all keyboard shortcut tips', () => {
		render(EditorTips, { props: { showTips: true } });
		expect(screen.getByText('Toggle editing mode')).toBeInTheDocument();
		expect(screen.getByText('Delete selected notes')).toBeInTheDocument();
		expect(screen.getByText('Copy selected notes')).toBeInTheDocument();
		expect(screen.getByText('Paste notes')).toBeInTheDocument();
		expect(screen.getByText('Undo last action')).toBeInTheDocument();
	});

	it('renders Show Tips button when showTips is false', () => {
		render(EditorTips, { props: { showTips: false } });
		expect(screen.getByRole('button', { name: /Show Tips/i })).toBeInTheDocument();
	});

	it('shows Hide button when tips are visible', () => {
		render(EditorTips, { props: { showTips: true } });
		expect(screen.getByRole('button', { name: /Hide/i })).toBeInTheDocument();
	});
});
