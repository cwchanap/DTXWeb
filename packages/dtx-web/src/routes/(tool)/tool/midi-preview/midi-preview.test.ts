import { describe, it, expect, vi } from 'vitest';
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

describe('MIDI Preview', () => {
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
});
