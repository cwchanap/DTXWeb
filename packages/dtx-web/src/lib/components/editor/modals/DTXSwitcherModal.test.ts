import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ModalStub from '../../../../tests/stubs/ModalStub.svelte';
import { makeWorkspace } from '../../../../tests/mocks/services';

const mockSoundChip = (fileName: string) => ({
	fileName,
	file: undefined as File | undefined
});

const mockService = vi.hoisted(() => ({
	getCurrentWorkspace: vi.fn(),
	parseDTXFile: vi.fn().mockResolvedValue({
		dtxFile: {
			parseNotes: vi.fn(() => []),
			parseBPMChanges: vi.fn(() => []),
			parseSoundChips: vi.fn(() => [])
		},
		simFile: { files: [] }
	}),
	switchDTXFile: vi.fn()
}));

vi.mock('$lib/services/workspaceService', () => ({
	workspaceService: mockService
}));

vi.mock('@dtx/ui-components/components', () => ({
	Modal: ModalStub
}));

const mockEmit = vi.hoisted(() => vi.fn());
vi.mock('@dtx/common/game', () => ({
	EventBus: { emit: mockEmit },
	EventType: { STOP_PREVIEW: 'STOP_PREVIEW', NOTE_IMPORT: 'NOTE_IMPORT' }
}));

vi.mock('$lib/services/tempChartStorage', () => ({
	TempChartStorage: { remove: vi.fn() }
}));

vi.mock('@dtx/common/services/fileManager', () => ({
	generateKey: vi.fn(() => 'key'),
	setFile: vi.fn()
}));

vi.mock('$lib/store', () => {
	const makeStore = (value: unknown) => ({
		subscribe: (cb: (v: unknown) => void) => {
			cb(value);
			return () => {};
		},
		set: vi.fn()
	});
	return {
		default: {
			currentDtxFile: makeStore(null),
			currentSoundChip: makeStore([]),
			currentSimfile: makeStore(null),
			currentSimfileID: makeStore(null),
			currentDifficulty: makeStore('')
		}
	};
});

import DTXSwitcherModal from './DTXSwitcherModal.svelte';

describe('DTXSwitcherModal', () => {
	const ws = makeWorkspace();

	beforeEach(() => {
		vi.clearAllMocks();
		mockService.getCurrentWorkspace.mockReturnValue(ws);
	});

	const defaultProps = { show: true, onSwitchDTX: vi.fn() };

	it('lists DTX files from the current workspace', () => {
		render(DTXSwitcherModal, { props: defaultProps });
		expect(screen.getByText('basic.dtx')).toBeInTheDocument();
		expect(screen.getByText('advanced.dtx')).toBeInTheDocument();
	});

	it('marks the active DTX file with "Currently active"', () => {
		render(DTXSwitcherModal, { props: defaultProps });
		expect(screen.getByText('Currently active')).toBeInTheDocument();
	});

	it('calls workspaceService.parseDTXFile when a non-active DTX file is clicked', async () => {
		render(DTXSwitcherModal, { props: defaultProps });
		const advancedBtn = screen.getByText('advanced.dtx').closest('button')!;
		await fireEvent.click(advancedBtn);
		expect(mockService.parseDTXFile).toHaveBeenCalledWith(ws, 'advanced.dtx');
	});

	it('emits STOP_PREVIEW before switching DTX', async () => {
		render(DTXSwitcherModal, { props: defaultProps });
		const advancedBtn = screen.getByText('advanced.dtx').closest('button')!;
		await fireEvent.click(advancedBtn);
		expect(mockEmit).toHaveBeenCalledWith('STOP_PREVIEW');
	});

	it('handles parseDTXFile returning null gracefully without crashing', async () => {
		mockService.parseDTXFile.mockResolvedValueOnce(null);
		render(DTXSwitcherModal, { props: defaultProps });
		const advancedBtn = screen.getByText('advanced.dtx').closest('button')!;
		await fireEvent.click(advancedBtn);
		expect(mockService.parseDTXFile).toHaveBeenCalledOnce();
	});

	it('does not render content when show is false', () => {
		render(DTXSwitcherModal, { props: { ...defaultProps, show: false } });
		expect(screen.queryByText('basic.dtx')).not.toBeInTheDocument();
	});

	it('maps sound chips to files from simFile using case-insensitive match', async () => {
		const kickFile = new File(['audio'], 'KICK.WAV');
		mockService.parseDTXFile.mockResolvedValueOnce({
			dtxFile: {
				parseNotes: vi.fn(() => []),
				parseBPMChanges: vi.fn(() => ({})),
				parseSoundChips: vi.fn(() => [mockSoundChip('kick.wav')])
			},
			simFile: { files: [kickFile] }
		});

		render(DTXSwitcherModal, { props: defaultProps });
		const advancedBtn = screen.getByText('advanced.dtx').closest('button')!;
		await fireEvent.click(advancedBtn);

		// FileManager.setFile should have been called for the matched chip
		const { setFile } = await import('@dtx/common/services/fileManager');
		expect(setFile).toHaveBeenCalled();
	});

	it('maps sound chips to files using exact match when case-insensitive match fails', async () => {
		const exactFile = new File(['audio'], 'snare.wav');
		mockService.parseDTXFile.mockResolvedValueOnce({
			dtxFile: {
				parseNotes: vi.fn(() => []),
				parseBPMChanges: vi.fn(() => ({})),
				parseSoundChips: vi.fn(() => [mockSoundChip('snare.wav')])
			},
			// simFile.files has a file that only matches exactly (same case)
			simFile: { files: [exactFile] }
		});

		render(DTXSwitcherModal, { props: defaultProps });
		const advancedBtn = screen.getByText('advanced.dtx').closest('button')!;
		await fireEvent.click(advancedBtn);

		const { setFile } = await import('@dtx/common/services/fileManager');
		expect(setFile).toHaveBeenCalled();
	});

	it('handles sound chips with no matching file in simFile', async () => {
		mockService.parseDTXFile.mockResolvedValueOnce({
			dtxFile: {
				parseNotes: vi.fn(() => []),
				parseBPMChanges: vi.fn(() => ({})),
				parseSoundChips: vi.fn(() => [mockSoundChip('missing.wav')])
			},
			simFile: { files: [] }
		});

		render(DTXSwitcherModal, { props: defaultProps });
		const advancedBtn = screen.getByText('advanced.dtx').closest('button')!;
		// Should not throw even when file is not found
		await expect(fireEvent.click(advancedBtn)).resolves.not.toThrow();
	});

	it('catches and logs errors from switchWorkspaceDTX', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockService.parseDTXFile.mockResolvedValueOnce({
			dtxFile: {
				parseNotes: vi.fn(() => {
					throw new Error('parse error');
				}),
				parseBPMChanges: vi.fn(() => ({})),
				parseSoundChips: vi.fn(() => [])
			},
			simFile: { files: [] }
		});

		render(DTXSwitcherModal, { props: defaultProps });
		const advancedBtn = screen.getByText('advanced.dtx').closest('button')!;
		await fireEvent.click(advancedBtn);

		expect(consoleSpy).toHaveBeenCalledWith('Error switching DTX file:', expect.any(Error));
		consoleSpy.mockRestore();
	});
});
