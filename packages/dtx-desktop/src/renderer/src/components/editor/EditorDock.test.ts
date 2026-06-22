import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('@lucide/svelte');
vi.mock('@dtx/common/components', () => ({
	MainTab: vi.fn(),
	SoundTab: vi.fn(),
	PreviewTab: vi.fn()
}));

import EditorDock from './EditorDock.svelte';

describe('EditorDock', () => {
	afterEach(() => cleanup());

	it('renders the three section headers', () => {
		render(EditorDock, { simfileId: null });
		expect(screen.getByRole('button', { name: /Chart Info/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Sounds/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Playback/i })).toBeInTheDocument();
	});

	it('toggles a section open/closed', async () => {
		render(EditorDock, { simfileId: null });
		const playback = screen.getByRole('button', { name: /Playback/i });
		expect(playback.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(playback);
		expect(playback.getAttribute('aria-expanded')).toBe('true');
	});
});
