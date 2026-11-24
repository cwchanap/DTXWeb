import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PopoverStub from '../../../../tests/stubs/PopoverStub.svelte';

// Mock dependencies for component logic tests
const gotoMock = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({
	goto: gotoMock
}));

vi.mock('svelte-i18n', () => ({
	locale: { set: vi.fn() },
	locales: {
		subscribe: (run: (value: string[]) => void) => {
			run(['en']);
			return () => {};
		}
	}
}));

const toastMock = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn()
}));

vi.mock('$lib/toaster', () => ({
	default: toastMock
}));

vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Popover: PopoverStub
}));

// Hoisted controllable mocks for DTXFile methods
const parseMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const parseNotesMock = vi.hoisted(() => vi.fn().mockReturnValue([]));

vi.mock('@dtx/common', async () => {
	// Reuse the shared mock so the real parseMidi/dtxToMidi/laneToStaff/
	// groupNotesByLane implementations stay exercised; only DTXFile is stubbed.
	const shared = await import('../../../../../../../__mocks__/@dtx/common');
	return {
		...shared,
		DTXFile: vi.fn().mockImplementation(function (this: any) {
			// ponytail: vitest 4+ constructable-mock rule — `new DTXFile()`
			Object.assign(this, {
				parse: parseMock,
				parseNotes: parseNotesMock,
				parseBPMChanges: vi.fn().mockReturnValue({}),
				parseMeasureLengths: vi.fn().mockReturnValue(new Map()),
				level: 1,
				artist: 'Mock Artist',
				bpm: 120,
				title: 'Mock Title',
				comment: 'Mock Comment'
			});
		})
	};
});

import DtxToMidi from './+page.svelte';
import { groupNotesByLane } from '@dtx/common';
import {
	DEFAULT_LANE_NOTE_MAP,
	isValidDtxFile,
	generateMidiFilename,
	formatFileSizeKB
} from './midi-helpers';

describe('DTX to MIDI Converter Logic', () => {
	it('isValidDtxFile accepts .dtx and .txt files, rejects others', () => {
		expect(isValidDtxFile(new File([''], 'song.dtx'))).toBe(true);
		expect(isValidDtxFile(new File([''], 'SONG.DTX'))).toBe(true);
		expect(isValidDtxFile(new File([''], 'song.txt'))).toBe(true);
		expect(isValidDtxFile(new File([''], 'song.mp3'))).toBe(false);
		expect(isValidDtxFile(new File([''], 'song.mid'))).toBe(false);
		expect(isValidDtxFile(new File([''], 'song'))).toBe(false);
	});

	it('generateMidiFilename replaces any extension with .mid', () => {
		expect(generateMidiFilename('mysong.dtx')).toBe('mysong.mid');
		expect(generateMidiFilename('track.txt')).toBe('track.mid');
		expect(generateMidiFilename('with.dots.in.name.dtx')).toBe('with.dots.in.name.mid');
	});

	it('formatFileSizeKB formats bytes as KB string with one decimal', () => {
		expect(formatFileSizeKB(1024)).toBe('1.0');
		expect(formatFileSizeKB(1024 * 5)).toBe('5.0');
		expect(formatFileSizeKB(1536)).toBe('1.5');
		expect(formatFileSizeKB(0)).toBe('0.0');
	});

	it('groupNotesByLane groups notes by their laneID', () => {
		const notes = [
			{ measure: 1, laneID: '01', notes: ['01', '00'] },
			{ measure: 1, laneID: '02', notes: ['00', '02'] },
			{ measure: 2, laneID: '01', notes: ['01', '00'] }
		] as any[];

		const result = groupNotesByLane(notes);

		expect(result['01']).toHaveLength(2);
		expect(result['02']).toHaveLength(1);
		expect(Object.keys(result)).toHaveLength(2);
		expect(result['01'][0]).toBe(notes[0]);
		expect(result['01'][1]).toBe(notes[2]);
	});

	it('groupNotesByLane returns empty object for empty input', () => {
		expect(groupNotesByLane([])).toEqual({});
	});

	it('DEFAULT_LANE_NOTE_MAP is seeded from the playable drum lanes', () => {
		expect(DEFAULT_LANE_NOTE_MAP['13']).toBe(36); // Bass Drum
		expect(DEFAULT_LANE_NOTE_MAP['12']).toBe(38); // Snare
		expect(DEFAULT_LANE_NOTE_MAP['11']).toBe(42); // Closed Hi-Hat
		expect(DEFAULT_LANE_NOTE_MAP['18']).toBe(46); // Open Hi-Hat
		expect(DEFAULT_LANE_NOTE_MAP['1B']).toBe(44); // Pedal Hi-Hat
		expect(DEFAULT_LANE_NOTE_MAP['1A']).toBe(57); // Left Crash
		expect(DEFAULT_LANE_NOTE_MAP['19']).toBe(51); // Ride
		expect(Object.keys(DEFAULT_LANE_NOTE_MAP)).toHaveLength(12);
		expect(DEFAULT_LANE_NOTE_MAP['01']).toBeUndefined(); // BGM lane is not a drum
		expect(DEFAULT_LANE_NOTE_MAP['08']).toBeUndefined(); // tempo lane is not a drum
	});
});

describe('DTX to MIDI Component Rendering', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('URL', {
			...URL,
			createObjectURL: vi.fn(() => 'blob:mock-url'),
			revokeObjectURL: vi.fn()
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders the page with initial upload state', () => {
		render(DtxToMidi);
		expect(screen.getByText('DTX to MIDI Converter')).toBeInTheDocument();
		expect(screen.getByText('Upload DTX File')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument();
	});

	it('shows Back to Tools button that calls goto', async () => {
		render(DtxToMidi);
		await fireEvent.click(screen.getByRole('button', { name: '← Back to Tools' }));
		expect(gotoMock).toHaveBeenCalledWith('/tool');
	});

	it('shows file ready state after uploading a valid .dtx file', async () => {
		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['#TITLE: Test\r\n'], 'song.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });
		expect(screen.getByText('File Ready')).toBeInTheDocument();
		expect(screen.getByText('song.dtx')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Convert to MIDI' })).toBeInTheDocument();
	});

	it('shows error toast for invalid file extension', async () => {
		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const badFile = new File(['bad'], 'audio.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(input, { target: { files: [badFile] } });
		expect(toastMock.error).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Invalid file type' })
		);
	});

	it('performs conversion and shows download section', async () => {
		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['#TITLE: Test\r\n'], 'mysong.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });

		await fireEvent.click(screen.getByRole('button', { name: 'Convert to MIDI' }));

		await vi.waitFor(() => {
			expect(screen.getByText('Conversion Complete!')).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: 'Download MIDI File' })).toBeInTheDocument();
		expect(screen.getByText('mysong.mid')).toBeInTheDocument();
	});

	it('shows error toast when conversion fails', async () => {
		parseMock.mockRejectedValueOnce(new Error('parse error'));

		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['bad content'], 'bad.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });

		await fireEvent.click(screen.getByRole('button', { name: 'Convert to MIDI' }));

		await vi.waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Conversion failed' })
			);
		});
	});

	it('downloads MIDI file and shows success toast', async () => {
		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['#TITLE: Test\r\n'], 'song.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to MIDI' }));

		await vi.waitFor(() => screen.getByText('Conversion Complete!'));

		await fireEvent.click(screen.getByRole('button', { name: 'Download MIDI File' }));

		await vi.waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Success' })
			);
		});
	});

	it('resets to initial state when Remove button is clicked', async () => {
		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });

		expect(screen.getByText('File Ready')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

		expect(screen.getByText('Upload DTX File')).toBeInTheDocument();
	});

	it('resets to initial state when Convert Another File button is clicked', async () => {
		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to MIDI' }));

		await vi.waitFor(() => screen.getByText('Conversion Complete!'));

		await fireEvent.click(screen.getByRole('button', { name: 'Convert Another File' }));
		expect(screen.getByText('Upload DTX File')).toBeInTheDocument();
	});

	it('shows error toast when download fails', async () => {
		parseNotesMock.mockImplementationOnce(() => {
			throw new Error('export error');
		});

		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to MIDI' }));
		await vi.waitFor(() => screen.getByText('Conversion Complete!'));

		await fireEvent.click(screen.getByRole('button', { name: 'Download MIDI File' }));

		await vi.waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Download failed' })
			);
		});
	});

	it('labels mapping rows with staff instrument names, never Unknown', async () => {
		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['#TITLE: Test\r\n'], 'song.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });

		expect(screen.getByText('Bass')).toBeTruthy();
		expect(screen.getByText('Snare')).toBeTruthy();
		expect(screen.getByText('Closed Hi-Hat')).toBeTruthy();
		expect(screen.getByText('Left Crash')).toBeTruthy();
		expect(screen.queryByText('Unknown')).toBeNull();
		// Lane ids are the real playable lanes, not the legacy 01-0C aliases.
		expect(container.querySelector('#lane-13')).not.toBeNull();
		expect(container.querySelector('#lane-01')).toBeNull();
	});

	it('shows nonfatal conversion warnings after download and clears them on replacement upload', async () => {
		parseNotesMock.mockReturnValue([
			{ measure: 0, laneID: '99', notes: [{ noteID: '01', position: 0 }], measureLength: 1 }
		]);

		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to MIDI' }));
		await vi.waitFor(() => screen.getByText('Conversion Complete!'));

		await fireEvent.click(screen.getByRole('button', { name: 'Download MIDI File' }));

		await vi.waitFor(() => {
			expect(screen.getByText(/lane 99 has no GM note/i)).toBeTruthy();
			expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
			expect(toastMock.success).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Success' })
			);
		});

		const nextFile = new File(['content2'], 'song2.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [nextFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to MIDI' }));
		await vi.waitFor(() => screen.getByText('Conversion Complete!'));
		expect(screen.queryByText(/lane 99 has no GM note/i)).toBeNull();
	});

	it('clicks file input when Choose Different File is clicked', async () => {
		const { container } = render(DtxToMidi);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		await fireEvent.change(input, { target: { files: [dtxFile] } });

		// File is uploaded - Choose Different File button is now visible
		const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
		await fireEvent.click(screen.getByRole('button', { name: 'Choose Different File' }));
		expect(clickSpy).toHaveBeenCalled();
		clickSpy.mockRestore();
	});
});
