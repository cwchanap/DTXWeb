import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { writable } from 'svelte/store';

vi.mock('@lucide/svelte');

const mockEventBus = vi.hoisted(() => ({
	emit: vi.fn(),
	on: vi.fn(),
	off: vi.fn()
}));

vi.mock('@dtx/common/game', () => ({
	EventBus: mockEventBus,
	EventType: {
		START_PREVIEW: 'start-preview',
		STOP_PREVIEW: 'stop-preview',
		CELL_HEIGHT_UPDATE: 'cell-height-update'
	}
}));

vi.mock('@dtx/common', () => ({
	store: {
		isPreviewing: writable(false),
		currentDtxFile: writable({ bpm: 145 }),
		measureCount: writable(40)
	}
}));

import TransportBar from './TransportBar.svelte';

describe('TransportBar', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('shows BPM and measure readouts', () => {
		render(TransportBar, { isEditorReady: true });
		expect(screen.getByText('145')).toBeInTheDocument();
		expect(screen.getByText('40')).toBeInTheDocument();
	});

	it('emits START_PREVIEW with bpm when play clicked', async () => {
		render(TransportBar, { isEditorReady: true });
		await fireEvent.click(screen.getByRole('button', { name: /play preview/i }));
		expect(mockEventBus.emit).toHaveBeenCalledWith('start-preview', 145);
	});

	it('emits STOP_PREVIEW on second click', async () => {
		render(TransportBar, { isEditorReady: true });
		const btn = screen.getByRole('button', { name: /(play|stop) preview/i });
		await fireEvent.click(btn);
		await fireEvent.click(btn);
		expect(mockEventBus.emit).toHaveBeenCalledWith('stop-preview');
	});

	it('emits CELL_HEIGHT_UPDATE when zoom changes', async () => {
		render(TransportBar, { isEditorReady: true });
		await fireEvent.input(screen.getByRole('slider', { name: /zoom/i }), {
			target: { value: '30' }
		});
		expect(mockEventBus.emit).toHaveBeenCalledWith('cell-height-update', 30);
	});
});
