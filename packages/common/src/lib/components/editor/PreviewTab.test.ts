import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use the real testing library (override global setup mock)
vi.mock('@testing-library/svelte', async () => await vi.importActual('@testing-library/svelte'));

// Mock icon imports
vi.mock('@lucide/svelte/icons', () => ({
	Play: vi.fn(),
	CirclePause: vi.fn()
}));

const { mockEmit, mockStore } = vi.hoisted(() => {
	const mockEmit = vi.fn();
	const mockStore = {
		isPreviewing: {
			subscribe: vi.fn((cb: (v: boolean) => void) => {
				cb(false);
				return () => {};
			}),
			set: vi.fn()
		},
		playSpeed: {
			subscribe: vi.fn((cb: (v: number) => void) => {
				cb(1);
				return () => {};
			}),
			set: vi.fn()
		},
		disableBgmPreview: {
			subscribe: vi.fn((cb: (v: boolean) => void) => {
				cb(false);
				return () => {};
			}),
			set: vi.fn()
		},
		currentDtxFile: {
			subscribe: vi.fn((cb: (v: null) => void) => {
				cb(null);
				return () => {};
			}),
			set: vi.fn()
		}
	};
	return { mockEmit, mockStore };
});

vi.mock('@dtx/common', () => ({
	store: mockStore
}));

vi.mock('@dtx/common/game', () => ({
	EventBus: { on: vi.fn(), off: vi.fn(), emit: mockEmit },
	EventType: {
		START_PREVIEW: 'start-preview',
		STOP_PREVIEW: 'stop-preview'
	}
}));

import { render, screen, fireEvent } from '@testing-library/svelte';
import PreviewTab from './PreviewTab.svelte';

describe('PreviewTab', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset subscribe stubs to return initial values
		mockStore.isPreviewing.subscribe.mockImplementation((cb: (v: boolean) => void) => {
			cb(false);
			return () => {};
		});
		mockStore.playSpeed.subscribe.mockImplementation((cb: (v: number) => void) => {
			cb(1);
			return () => {};
		});
		mockStore.disableBgmPreview.subscribe.mockImplementation((cb: (v: boolean) => void) => {
			cb(false);
			return () => {};
		});
		mockStore.currentDtxFile.subscribe.mockImplementation((cb: (v: null) => void) => {
			cb(null);
			return () => {};
		});
	});

	it('renders the play speed input', () => {
		render(PreviewTab);
		expect(screen.getByRole('spinbutton')).toBeInTheDocument();
	});

	it('renders the disable BGM preview checkbox', () => {
		render(PreviewTab);
		expect(screen.getByRole('checkbox')).toBeInTheDocument();
	});

	it('renders the play/pause button', () => {
		render(PreviewTab);
		expect(screen.getByRole('button')).toBeInTheDocument();
	});

	it('renders with isEditorReady prop', () => {
		render(PreviewTab, { props: { isEditorReady: true } });
		expect(screen.getByRole('button')).toBeInTheDocument();
	});

	it('emits START_PREVIEW when play button clicked', async () => {
		render(PreviewTab);
		const btn = screen.getByRole('button');
		await fireEvent.click(btn);
		expect(mockEmit).toHaveBeenCalledWith('start-preview', expect.anything());
	});

	it('emits STOP_PREVIEW when stop button clicked', async () => {
		render(PreviewTab);
		const btn = screen.getByRole('button');
		await fireEvent.click(btn); // start
		await fireEvent.click(btn); // stop
		expect(mockEmit).toHaveBeenCalledWith('stop-preview');
	});

	it('calls playSpeed.set on input change', async () => {
		render(PreviewTab);
		const input = screen.getByRole('spinbutton');
		await fireEvent.change(input);
		expect(mockStore.playSpeed.set).toHaveBeenCalled();
	});

	it('toggles disable BGM preview checkbox', async () => {
		render(PreviewTab);
		const checkbox = screen.getByRole('checkbox');
		await fireEvent.click(checkbox);
		expect(mockStore.disableBgmPreview.set).toHaveBeenCalled();
	});
});
