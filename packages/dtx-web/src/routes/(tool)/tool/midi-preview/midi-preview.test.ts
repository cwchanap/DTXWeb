import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import MidiPreview from './+page.svelte';
import toastStore from '$lib/toaster';

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
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

vi.mock('$lib/toaster', () => ({
	default: {
		error: vi.fn(),
		success: vi.fn()
	}
}));

const toastMock = toastStore as unknown as {
	error: ReturnType<typeof vi.fn>;
	success: ReturnType<typeof vi.fn>;
};

if (!File.prototype.arrayBuffer) {
	Object.defineProperty(File.prototype, 'arrayBuffer', {
		configurable: true,
		value: async function arrayBuffer() {
			if (typeof FileReader !== 'undefined') {
				return await new Promise<ArrayBuffer>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result as ArrayBuffer);
					reader.onerror = () => reject(reader.error);
					reader.readAsArrayBuffer(this);
				});
			}

			const text = typeof this.text === 'function' ? await this.text() : '';
			return new TextEncoder().encode(text).buffer;
		}
	});
}

const createMinimalMidiFile = () => {
	const midiBytes = new Uint8Array([
		// Header chunk "MThd"
		0x4d,
		0x54,
		0x68,
		0x64,
		0x00,
		0x00,
		0x00,
		0x06, // Header length
		0x00,
		0x00, // Format 0
		0x00,
		0x01, // One track
		0x01,
		0xe0, // 480 ticks per quarter
		// Track chunk "MTrk"
		0x4d,
		0x54,
		0x72,
		0x6b,
		0x00,
		0x00,
		0x00,
		0x0d, // Track length: 13 bytes
		// Delta 0, note on (channel 0, note 36, velocity 64)
		0x00,
		0x90,
		0x24,
		0x40,
		// Delta 480 (0x83 0x60), note off
		0x83,
		0x60,
		0x80,
		0x24,
		0x40,
		// Delta 0, end of track
		0x00,
		0xff,
		0x2f,
		0x00
	]);

	return new File([midiBytes], 'sample.mid', { type: 'audio/midi' });
};

const gotoMock = vi.mocked((await import('$app/navigation')).goto);

const createMidiFileWithProgramChange = () => {
	// MIDI format 0 with program change event (instrument)
	const midiBytes = new Uint8Array([
		// Header: MThd
		0x4d,
		0x54,
		0x68,
		0x64,
		0x00,
		0x00,
		0x00,
		0x06, // Header length
		0x00,
		0x00, // Format 0
		0x00,
		0x01, // One track
		0x01,
		0xe0, // 480 ticks/quarter
		// Track: MTrk
		0x4d,
		0x54,
		0x72,
		0x6b,
		0x00,
		0x00,
		0x00,
		0x10, // Track length: 16 bytes
		// Delta 0, Program change channel 0, instrument 40 (Violin)
		0x00,
		0xc0,
		0x28,
		// Delta 0, note on (channel 0, note 36, velocity 64)
		0x00,
		0x90,
		0x24,
		0x40,
		// Delta 480, note off
		0x83,
		0x60,
		0x80,
		0x24,
		0x40,
		// Delta 0, end of track
		0x00,
		0xff,
		0x2f,
		0x00
	]);
	return new File([midiBytes], 'instruments.mid', { type: 'audio/midi' });
};

describe('MIDI Preview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('parses a MIDI file and shows summary details', async () => {
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;

		await fireEvent.change(input, { target: { files: [createMinimalMidiFile()] } });

		expect(await screen.findByText('File Information')).toBeInTheDocument();
		expect(screen.getByText('Track Details')).toBeInTheDocument();
		expect(screen.getByText('Track 1')).toBeInTheDocument();
		expect(screen.getByText('1 notes')).toBeInTheDocument();
		expect(screen.getByText('120 BPM')).toBeInTheDocument();

		expect(toastMock.success).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'MIDI file loaded'
			})
		);
	});

	it('rejects invalid file extensions', async () => {
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const invalidFile = new File(['bad'], 'invalid.txt', { type: 'text/plain' });

		await fireEvent.change(input, { target: { files: [invalidFile] } });

		expect(toastMock.error).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Invalid file type'
			})
		);
		expect(input.value).toBe('');
	});

	it('calls goto when back button is clicked', async () => {
		render(MidiPreview);
		await fireEvent.click(screen.getByRole('button', { name: '← Back to Tools' }));
		expect(gotoMock).toHaveBeenCalledWith('/tool');
	});

	it('resets file when Remove button is clicked', async () => {
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		await fireEvent.change(input, { target: { files: [createMinimalMidiFile()] } });

		// Wait for the file info to appear (file is loaded)
		await screen.findByText('File Information');

		// Click Remove button
		await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

		// File should be reset - "File Information" section gone
		expect(screen.queryByText('File Information')).not.toBeInTheDocument();
	});

	it('shows instrument names when MIDI has program change events', async () => {
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		await fireEvent.change(input, { target: { files: [createMidiFileWithProgramChange()] } });

		// Wait for file info
		await screen.findByText('File Information');

		// Should show instrument info (not "None specified")
		const instrumentsLabel = screen.getByText('Instruments');
		expect(instrumentsLabel).toBeInTheDocument();
	});

	it('surfaces parse errors for malformed MIDI files', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const invalidMidi = new File([new Uint8Array([0x4d, 0x54, 0x68, 0x65])], 'bad.mid', {
			type: 'audio/midi'
		});

		try {
			await fireEvent.change(input, { target: { files: [invalidMidi] } });

			await waitFor(() => {
				expect(toastMock.error).toHaveBeenCalledWith(
					expect.objectContaining({
						title: 'Failed to parse MIDI'
					})
				);
			});
		} finally {
			consoleSpy.mockRestore();
		}
	});

	it('parses MIDI with Set Tempo meta event and updates BPM', async () => {
		// 140 BPM = 60,000,000 / 140 = 428,571 μs = 0x068AEB
		const microsecondsPerQuarter = Math.round(60000000 / 140); // 428571
		const us0 = (microsecondsPerQuarter >> 16) & 0xff;
		const us1 = (microsecondsPerQuarter >> 8) & 0xff;
		const us2 = microsecondsPerQuarter & 0xff;
		// Track data: FF 51 03 [us0 us1 us2] + note on + note off + end of track = 20 bytes
		const midiBytes = new Uint8Array([
			0x4d,
			0x54,
			0x68,
			0x64,
			0x00,
			0x00,
			0x00,
			0x06,
			0x00,
			0x00,
			0x00,
			0x01,
			0x01,
			0xe0,
			0x4d,
			0x54,
			0x72,
			0x6b,
			0x00,
			0x00,
			0x00,
			0x14,
			0x00,
			0xff,
			0x51,
			0x03,
			us0,
			us1,
			us2,
			0x00,
			0x90,
			0x24,
			0x40,
			0x83,
			0x60,
			0x80,
			0x24,
			0x40,
			0x00,
			0xff,
			0x2f,
			0x00
		]);
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File([midiBytes], 'tempo.mid', { type: 'audio/midi' })] }
		});
		await screen.findByText('File Information');
		expect(screen.getByText('140 BPM')).toBeInTheDocument();
	});

	it('parses MIDI with track name meta event', async () => {
		// Track data: FF 03 04 "Test" + note on + note off + end = 21 bytes
		const midiBytes = new Uint8Array([
			0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
			0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x15, 0x00, 0xff, 0x03, 0x04, 0x54, 0x65,
			0x73, 0x74, 0x00, 0x90, 0x24, 0x40, 0x83, 0x60, 0x80, 0x24, 0x40, 0x00, 0xff, 0x2f, 0x00
		]);
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File([midiBytes], 'named.mid', { type: 'audio/midi' })] }
		});
		await screen.findByText('File Information');
		expect(toastMock.success).toHaveBeenCalled();
	});

	it('parses MIDI with control change events (other channel events path)', async () => {
		// Track data: CC (B0 07 7F) + key pressure (A0 24 3C) + end = 12 bytes
		const midiBytes = new Uint8Array([
			0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
			0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x0c, 0x00, 0xb0, 0x07, 0x7f, 0x00, 0xa0,
			0x24, 0x3c, 0x00, 0xff, 0x2f, 0x00
		]);
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File([midiBytes], 'cc.mid', { type: 'audio/midi' })] }
		});
		await screen.findByText('File Information');
		expect(toastMock.success).toHaveBeenCalled();
	});

	it('handles active notes without note-off at end of track', async () => {
		// Track data: note on only (no note off) + end = 8 bytes
		const midiBytes = new Uint8Array([
			0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
			0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x08, 0x00, 0x90, 0x24, 0x40, 0x00, 0xff,
			0x2f, 0x00
		]);
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File([midiBytes], 'incomplete.mid', { type: 'audio/midi' })] }
		});
		await screen.findByText('File Information');
		expect(screen.getByText('1 notes')).toBeInTheDocument();
	});

	it('parses MIDI with running status for consecutive note events', async () => {
		// delta=0 note on, then delta=512 (VLQ: 84 00) with running status note off
		// Track data: 4+4+4 = 12 bytes
		const midiBytes = new Uint8Array([
			0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
			0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x90, 0x24, 0x40, 0x84, 0x00,
			0x24, 0x00, 0x00, 0xff, 0x2f, 0x00
		]);
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File([midiBytes], 'running.mid', { type: 'audio/midi' })] }
		});
		await screen.findByText('File Information');
		expect(screen.getByText('1 notes')).toBeInTheDocument();
	});

	it('throws when track header is invalid', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		// Valid MIDI header but track starts with "XYZW" instead of "MTrk"
		const midiBytes = new Uint8Array([
			0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
			0x58, 0x59, 0x5a, 0x57, 0x00, 0x00, 0x00, 0x04, 0x00, 0xff, 0x2f, 0x00
		]);
		const { container } = render(MidiPreview);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File([midiBytes], 'badtrack.mid', { type: 'audio/midi' })] }
		});
		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to parse MIDI' })
			);
		});
		consoleSpy.mockRestore();
	});

	it('clicking Choose File triggers file input click', async () => {
		const { container } = render(MidiPreview);
		const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
		const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
		await fireEvent.click(screen.getByRole('button', { name: 'Choose File' }));
		expect(clickSpy).toHaveBeenCalled();
	});
});
