import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use the real testing library (override global setup mock)
vi.mock('@testing-library/svelte', async () => await vi.importActual('@testing-library/svelte'));

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
		measureCount: {
			subscribe: vi.fn((cb: (v: number) => void) => {
				cb(10);
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
	store: mockStore,
	DTXFile: vi.fn()
}));

vi.mock('@dtx/common/game', () => ({
	EventBus: { on: vi.fn(), off: vi.fn(), emit: mockEmit },
	EventType: {
		MEASURE_UPDATE: 'measure-update',
		MEASURE_GOTO: 'measure-goto',
		GRID_SPACING_UPDATE: 'grid-spacing-update',
		CELL_HEIGHT_UPDATE: 'cell-height-update',
		VALIDATION_ERROR: 'validation-error'
	}
}));

vi.mock('@dtx/ui-components', () => ({
	ToggleGroup: vi.fn()
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import MainTab from './MainTab.svelte';

describe('MainTab', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStore.isPreviewing.subscribe.mockImplementation((cb: (v: boolean) => void) => {
			cb(false);
			return () => {};
		});
		mockStore.measureCount.subscribe.mockImplementation((cb: (v: number) => void) => {
			cb(10);
			return () => {};
		});
		mockStore.currentDtxFile.subscribe.mockImplementation((cb: (v: null) => void) => {
			cb(null);
			return () => {};
		});
	});

	it('renders Title input', () => {
		render(MainTab);
		expect(screen.getByLabelText('Title:')).toBeInTheDocument();
	});

	it('renders Artist input', () => {
		render(MainTab);
		expect(screen.getByLabelText('Artist:')).toBeInTheDocument();
	});

	it('renders Comment input', () => {
		render(MainTab);
		expect(screen.getByLabelText('Comment:')).toBeInTheDocument();
	});

	it('renders BPM input', () => {
		render(MainTab);
		expect(screen.getByLabelText('BPM:')).toBeInTheDocument();
	});

	it('renders Level input', () => {
		render(MainTab);
		expect(screen.getByLabelText('Level:')).toBeInTheDocument();
	});

	it('renders Number of Measures input', () => {
		render(MainTab);
		expect(screen.getByLabelText('Number of Measures:')).toBeInTheDocument();
	});

	it('renders Cell Height Apply button', () => {
		render(MainTab);
		expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
	});

	it('renders Go to Measure Go button', () => {
		render(MainTab);
		expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
	});

	it('emits MEASURE_UPDATE when measure count changes', async () => {
		render(MainTab);
		const input = screen.getByLabelText('Number of Measures:');
		await fireEvent.change(input);
		expect(mockEmit).toHaveBeenCalledWith('measure-update', expect.anything());
	});

	it('emits MEASURE_GOTO when Go button clicked', async () => {
		render(MainTab);
		const btn = screen.getByRole('button', { name: 'Go' });
		await fireEvent.click(btn);
		expect(mockEmit).toHaveBeenCalledWith('measure-goto', expect.anything());
	});

	it('emits CELL_HEIGHT_UPDATE when Apply button clicked with valid height', async () => {
		render(MainTab);
		const btn = screen.getByRole('button', { name: 'Apply' });
		await fireEvent.click(btn);
		expect(mockEmit).toHaveBeenCalledWith('cell-height-update', expect.anything());
	});

	it('emits VALIDATION_ERROR when cell height is out of range', async () => {
		render(MainTab);
		const cellHeightInput = screen.getByLabelText('Cell Height:');
		// Use fireEvent.input so Svelte's bind:value sees the change
		await fireEvent.input(cellHeightInput, { target: { value: '2' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		expect(mockEmit).toHaveBeenCalledWith('validation-error', expect.anything());
	});

	it('handles Enter key on cell height input', async () => {
		render(MainTab);
		const cellHeightInput = screen.getByLabelText('Cell Height:');
		await fireEvent.keyDown(cellHeightInput, { key: 'Enter' });
		expect(mockEmit).toHaveBeenCalled();
	});

	it('renders with isPreviewing=true disables inputs', async () => {
		mockStore.isPreviewing.subscribe.mockImplementation((cb: (v: boolean) => void) => {
			cb(true);
			return () => {};
		});
		render(MainTab);
		expect(screen.getByLabelText('BPM:')).toBeDisabled();
		expect(screen.getByLabelText('Number of Measures:')).toBeDisabled();
	});

	it('sets store.measureCount when measure count changes', async () => {
		render(MainTab);
		const input = screen.getByLabelText('Number of Measures:');
		await fireEvent.change(input);
		expect(mockStore.measureCount.set).toHaveBeenCalled();
	});

	it('syncs dtxFile properties to store when dtxFile is non-null', async () => {
		const mockDtxFile = {
			title: 'Test Title',
			artist: 'Test Artist',
			comment: 'Test Comment',
			bpm: 130,
			level: 7
		};

		mockStore.currentDtxFile.subscribe.mockImplementation(
			(cb: (v: typeof mockDtxFile | null) => void) => {
				cb(mockDtxFile);
				return () => {};
			}
		);

		render(MainTab);

		await waitFor(() => {
			expect(mockStore.currentDtxFile.set).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Test Title', artist: 'Test Artist' })
			);
		});
	});

	it('updates dtxFile title property when title input changes', async () => {
		const mockDtxFile = {
			title: 'Original Title',
			artist: 'Artist',
			comment: '',
			bpm: 120,
			level: 0
		};

		mockStore.currentDtxFile.subscribe.mockImplementation(
			(cb: (v: typeof mockDtxFile | null) => void) => {
				cb(mockDtxFile);
				return () => {};
			}
		);

		render(MainTab);

		const titleInput = screen.getByLabelText('Title:');
		await fireEvent.input(titleInput, { target: { value: 'New Title' } });

		await waitFor(() => {
			expect(mockStore.currentDtxFile.set).toHaveBeenCalled();
		});
	});
});
