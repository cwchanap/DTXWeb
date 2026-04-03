import { describe, it, expect, vi, beforeEach } from 'vitest';

// Override global @testing-library/svelte mock with the actual library
vi.mock('@testing-library/svelte', async () => await vi.importActual('@testing-library/svelte'));

const { mockStore, MockSoundChip, mockXAaudioContext, mockFileManager } = vi.hoisted(() => {
	class MockSoundChip {
		label: string;
		id: number;
		volume: number;
		position: number;
		fileName: string;
		file?: File;
		fetchRemote = vi.fn();

		constructor(
			label: string,
			id: number,
			volume: number,
			position: number,
			fileName: string,
			file?: File
		) {
			this.label = label;
			this.id = id;
			this.volume = volume;
			this.position = position;
			this.fileName = (fileName || '').toLowerCase();
			this.file = file;
		}
	}

	const mockStore = {
		currentSoundChip: {
			subscribe: vi.fn((cb: (v: MockSoundChip[]) => void) => {
				cb([]);
				return () => {};
			}),
			set: vi.fn()
		},
		currentSimfile: {
			subscribe: vi.fn((cb: (v: null) => void) => {
				cb(null);
				return () => {};
			})
		},
		activeNote: {
			subscribe: vi.fn((cb: (v: string) => void) => {
				cb('01');
				return () => {};
			}),
			set: vi.fn()
		},
		keyBindings: {
			set: vi.fn()
		}
	};

	const mockXAaudioContext = {
		createBufferSource: vi.fn(() => ({ buffer: null, connect: vi.fn(), start: vi.fn() })),
		createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
		decodeAudioData: vi.fn(() =>
			Promise.resolve({
				duration: 0,
				numberOfChannels: 1,
				sampleRate: 44100,
				length: 0,
				getChannelData: vi.fn(() => new Float32Array(0))
			})
		),
		destination: {}
	};

	const mockFileManager = {
		generateKey: vi.fn((id: string | null, file: string) => `${id ?? 'null'}/${file}`),
		getFile: vi.fn(() => undefined),
		setFile: vi.fn()
	};

	return { mockStore, MockSoundChip, mockXAaudioContext, mockFileManager };
});

vi.mock('@dtx/common', () => ({
	store: mockStore,
	SoundChip: MockSoundChip
}));

vi.mock('../../browser/audioDecoder', () => ({
	XAaudioContext: mockXAaudioContext
}));

vi.mock('../../services/fileManager', () => mockFileManager);

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SoundTab from './SoundTab.svelte';

// ── utility tests (no component rendering) ──────────────────────────────────

describe('SoundTab utilities', () => {
	describe('volume validation', () => {
		const isValidVolume = (volume: number): boolean => volume >= 0 && volume <= 100;

		it('should validate volume ranges correctly', () => {
			expect(isValidVolume(75)).toBe(true);
			expect(isValidVolume(0)).toBe(true);
			expect(isValidVolume(100)).toBe(true);
			expect(isValidVolume(-1)).toBe(false);
			expect(isValidVolume(101)).toBe(false);
			expect(isValidVolume(50.5)).toBe(true);
		});

		it('should handle edge cases for volume validation', () => {
			expect(isValidVolume(Number.NaN)).toBe(false);
			expect(isValidVolume(Number.POSITIVE_INFINITY)).toBe(false);
			expect(isValidVolume(Number.NEGATIVE_INFINITY)).toBe(false);
		});
	});

	describe('volume normalization', () => {
		const normalizeVolume = (volume: number): number => Math.max(0, Math.min(1, volume / 100));

		it('should normalize volume for audio playback', () => {
			expect(normalizeVolume(75)).toBe(0.75);
			expect(normalizeVolume(0)).toBe(0);
			expect(normalizeVolume(100)).toBe(1);
			expect(normalizeVolume(50)).toBe(0.5);
		});

		it('should clamp out-of-range volumes', () => {
			expect(normalizeVolume(150)).toBe(1);
			expect(normalizeVolume(-50)).toBe(0);
		});
	});

	describe('file type detection', () => {
		const isXAFile = (fileName: string): boolean => fileName.toLowerCase().endsWith('.xa');

		it('should detect XA files correctly', () => {
			expect(isXAFile('test.xa')).toBe(true);
			expect(isXAFile('test.XA')).toBe(true);
			expect(isXAFile('Test.Xa')).toBe(true);
			expect(isXAFile('file.with.dots.xa')).toBe(true);
		});

		it('should reject non-XA files', () => {
			expect(isXAFile('test.wav')).toBe(false);
			expect(isXAFile('test.mp3')).toBe(false);
			expect(isXAFile('test.xa.backup')).toBe(false);
			expect(isXAFile('testxa')).toBe(false);
		});
	});

	describe('sound chip ID generation', () => {
		const generateNextId = (existingChips: Array<{ id: number }>): number => {
			if (existingChips.length === 0) return 1;
			return Math.max(...existingChips.map((chip) => chip.id)) + 1;
		};

		it('should generate sequential IDs for sound chips', () => {
			expect(generateNextId([])).toBe(1);
			expect(generateNextId([{ id: 1 }])).toBe(2);
			expect(generateNextId([{ id: 1 }, { id: 3 }])).toBe(4);
			expect(generateNextId([{ id: 5 }, { id: 2 }, { id: 8 }])).toBe(9);
		});

		it('should handle gaps in ID sequences', () => {
			expect(generateNextId([{ id: 1 }, { id: 5 }, { id: 10 }])).toBe(11);
			expect(generateNextId([{ id: 100 }])).toBe(101);
		});

		it('should handle duplicate IDs', () => {
			expect(generateNextId([{ id: 1 }, { id: 1 }, { id: 2 }])).toBe(3);
		});
	});
});

// ── component rendering tests ────────────────────────────────────────────────

describe('SoundTab component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([]);
				return () => {};
			}
		);
		mockStore.currentSimfile.subscribe.mockImplementation((cb: (v: null) => void) => {
			cb(null);
			return () => {};
		});
		mockStore.activeNote.subscribe.mockImplementation((cb: (v: string) => void) => {
			cb('01');
			return () => {};
		});
	});

	it('renders table headers', () => {
		render(SoundTab);
		expect(screen.getByText('Active')).toBeInTheDocument();
		expect(screen.getByText('Label')).toBeInTheDocument();
		expect(screen.getByText('ID')).toBeInTheDocument();
		expect(screen.getByText('Volume')).toBeInTheDocument();
		expect(screen.getByText('Position')).toBeInTheDocument();
		expect(screen.getByText('Key Binding')).toBeInTheDocument();
		expect(screen.getByText('File')).toBeInTheDocument();
	});

	it('shows New Sound button for local charts (no simfileID)', () => {
		render(SoundTab);
		expect(screen.getByText('New Sound')).toBeInTheDocument();
	});

	it('hides New Sound button for remote charts (simfileID provided)', () => {
		render(SoundTab, { props: { simfileID: 'sim-1' } });
		expect(screen.queryByText('New Sound')).not.toBeInTheDocument();
	});

	it('clicking New Sound adds a chip to the store', async () => {
		render(SoundTab);
		await fireEvent.click(screen.getByText('New Sound'));
		expect(mockStore.currentSoundChip.set).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ id: 1 })])
		);
	});

	it('clicking New Sound with existing chips uses next id', async () => {
		const chip = new MockSoundChip('kick', 3, 100, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		await fireEvent.click(screen.getByText('New Sound'));
		expect(mockStore.currentSoundChip.set).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ id: 4 })])
		);
	});

	it('renders a chip row with correct ID (base-36)', () => {
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		// id=1 -> base36='1' -> padded='01'
		expect(screen.getByText('01')).toBeInTheDocument();
	});

	it('clicking active button calls store.activeNote.set with chip ID', async () => {
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		await fireEvent.click(screen.getByTitle('Set as active note'));
		expect(mockStore.activeNote.set).toHaveBeenCalledWith('01');
	});

	it('highlights the active chip with ring styling', () => {
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		mockStore.activeNote.subscribe.mockImplementation((cb: (v: string) => void) => {
			cb('01');
			return () => {};
		});
		render(SoundTab);
		// Active chip row should have ring-2 class
		const row = document.querySelector('tr.ring-2');
		expect(row).toBeInTheDocument();
	});

	it('shows file upload input for local chip without a file', () => {
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
	});

	it('shows chip file name as button for local chip with a file', () => {
		const file = new File(['content'], 'kick.wav', { type: 'audio/wav' });
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav', file);
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		expect(screen.getByText('kick.wav')).toBeInTheDocument();
		// Should also have a remove button
		expect(screen.getByTitle('Remove file')).toBeInTheDocument();
	});

	it('removes file from chip when remove button clicked', async () => {
		const file = new File(['content'], 'kick.wav', { type: 'audio/wav' });
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav', file);
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		await fireEvent.click(screen.getByTitle('Remove file'));
		expect(mockStore.currentSoundChip.set).toHaveBeenCalledWith(
			expect.arrayContaining([expect.not.objectContaining({ file: expect.anything() })])
		);
	});

	it('plays local audio file when filename button clicked', async () => {
		const file = new File(['content'], 'kick.wav', { type: 'audio/wav' });
		global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav', file);
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		const fileBtn = screen.getByText('kick.wav');
		await fireEvent.click(fileBtn);
		expect(URL.createObjectURL).toHaveBeenCalled();
	});

	it('shows fileName as button for remote chip with fileName', () => {
		const chip = new MockSoundChip('kick', 1, 100, 0, 'snare.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab, { props: { simfileID: 'sim-1' } });
		expect(screen.getByText('snare.wav')).toBeInTheDocument();
	});

	it('shows No file assigned for remote chip with empty fileName', () => {
		const chip = new MockSoundChip('kick', 1, 100, 0, '');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab, { props: { simfileID: 'sim-1' } });
		expect(screen.getByText('No file assigned')).toBeInTheDocument();
	});

	it('plays remote audio when remote fileName button clicked (file in FileManager)', async () => {
		const file = new File(['content'], 'snare.wav', { type: 'audio/wav' });
		global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
		mockFileManager.generateKey.mockReturnValue('sim-1/snare.wav');
		mockFileManager.getFile.mockReturnValue(file);
		const chip = new MockSoundChip('snare', 1, 100, 0, 'snare.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab, { props: { simfileID: 'sim-1', bucketUrl: 'https://cdn.example.com' } });
		const fileBtn = screen.getByText('snare.wav');
		await fireEvent.click(fileBtn);
		expect(URL.createObjectURL).toHaveBeenCalled();
	});

	it('fetches and plays remote audio when not in FileManager but bucketUrl provided', async () => {
		mockFileManager.getFile.mockReturnValue(undefined);
		global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

		const fetchedFile = new File(['audio'], 'snare.wav', { type: 'audio/wav' });
		const chip = new MockSoundChip('snare', 1, 100, 0, 'snare.wav');
		chip.fetchRemote = vi.fn().mockImplementation(async () => {
			chip.file = fetchedFile;
		});
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab, { props: { simfileID: 'sim-1', bucketUrl: 'https://cdn.example.com' } });
		await fireEvent.click(screen.getByText('snare.wav'));
		await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
		expect(mockFileManager.setFile).toHaveBeenCalled();
	});

	it('shows error toast when remote file fetch throws', async () => {
		mockFileManager.getFile.mockReturnValue(undefined);

		const chip = new MockSoundChip('snare', 1, 100, 0, 'snare.wav');
		chip.fetchRemote = vi.fn().mockRejectedValue(new Error('Network error'));
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab, { props: { simfileID: 'sim-1', bucketUrl: 'https://cdn.example.com' } });
		await fireEvent.click(screen.getByText('snare.wav'));
		await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
		expect(screen.getByRole('alert').textContent).toContain('Failed to load remote audio file');
	});

	it('shows warning toast when remote file is not yet loaded', async () => {
		mockFileManager.getFile.mockReturnValue(undefined);
		const chip = new MockSoundChip('snare', 1, 100, 0, 'snare.wav');
		// chip.file is undefined and no bucketUrl provided
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab, { props: { simfileID: 'sim-1' } });
		await fireEvent.click(screen.getByText('snare.wav'));
		expect(screen.getByRole('alert')).toBeInTheDocument();
	});

	it('plays XA file using XAaudioContext', async () => {
		const file = new File(['content'], 'kick.xa', { type: 'audio/xa' });
		file.arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.xa', file);
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		await fireEvent.click(screen.getByText('kick.xa'));
		await waitFor(() => expect(mockXAaudioContext.decodeAudioData).toHaveBeenCalled());
	});

	it('handles audio playback error gracefully (no throw)', async () => {
		// Make audio.play() reject to trigger the catch block at line 142-143
		const originalAudio = global.Audio;
		try {
			global.Audio = vi.fn().mockImplementation(() => ({
				play: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
				volume: 1
			})) as unknown as typeof Audio;
			global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

			const file = new File(['content'], 'kick.wav', { type: 'audio/wav' });
			const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav', file);
			mockStore.currentSoundChip.subscribe.mockImplementation(
				(cb: (v: MockSoundChip[]) => void) => {
					cb([chip]);
					return () => {};
				}
			);
			render(SoundTab);
			await fireEvent.click(screen.getByText('kick.wav'));
			// The error is swallowed — component should still be in the document
			await waitFor(() => expect(global.Audio).toHaveBeenCalled());
		} finally {
			global.Audio = originalAudio;
		}
	});

	it('assigns a file to a chip via file input change', async () => {
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
		const newFile = new File(['audio'], 'newkick.wav', { type: 'audio/wav' });
		await fireEvent.change(fileInput, { target: { files: [newFile] } });
		expect(mockStore.currentSoundChip.set).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ file: newFile })])
		);
	});

	it('applies dark theme classes by default', () => {
		render(SoundTab);
		// Dark theme table head should have bg-slate-800/80
		const thead = document.querySelector('thead');
		expect(thead?.className).toContain('bg-slate-800');
	});

	it('applies light theme classes when theme=light', () => {
		render(SoundTab, { props: { theme: 'light' } });
		const thead = document.querySelector('thead');
		expect(thead?.className).toContain('bg-gray-100');
	});
});

// ── key binding tests ─────────────────────────────────────────────────────────

describe('SoundTab key binding', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		mockStore.currentSimfile.subscribe.mockImplementation((cb: (v: null) => void) => {
			cb(null);
			return () => {};
		});
		mockStore.activeNote.subscribe.mockImplementation((cb: (v: string) => void) => {
			cb('01');
			return () => {};
		});
	});

	it('sets key binding when a regular key is pressed', async () => {
		render(SoundTab);
		await fireEvent.keyDown(screen.getByPlaceholderText('Press key'), { key: 'a' });
		expect(mockStore.keyBindings.set).toHaveBeenCalled();
	});

	it('clears binding on Backspace', async () => {
		render(SoundTab);
		await fireEvent.keyDown(screen.getByPlaceholderText('Press key'), { key: 'Backspace' });
		expect(mockStore.keyBindings.set).toHaveBeenCalled();
	});

	it('clears binding on Delete', async () => {
		render(SoundTab);
		await fireEvent.keyDown(screen.getByPlaceholderText('Press key'), { key: 'Delete' });
		expect(mockStore.keyBindings.set).toHaveBeenCalled();
	});

	it('ignores modifier keys (Shift)', async () => {
		render(SoundTab);
		await fireEvent.keyDown(screen.getByPlaceholderText('Press key'), { key: 'Shift' });
		expect(mockStore.keyBindings.set).not.toHaveBeenCalled();
	});

	it('ignores modifier keys (Control)', async () => {
		render(SoundTab);
		await fireEvent.keyDown(screen.getByPlaceholderText('Press key'), { key: 'Control' });
		expect(mockStore.keyBindings.set).not.toHaveBeenCalled();
	});

	it('ignores ArrowUp key', async () => {
		render(SoundTab);
		await fireEvent.keyDown(screen.getByPlaceholderText('Press key'), { key: 'ArrowUp' });
		expect(mockStore.keyBindings.set).not.toHaveBeenCalled();
	});

	it('allows Enter key as a binding', async () => {
		render(SoundTab);
		await fireEvent.keyDown(screen.getByPlaceholderText('Press key'), { key: 'Enter' });
		expect(mockStore.keyBindings.set).toHaveBeenCalled();
	});

	it('shows error toast when reserved key q is pressed', async () => {
		render(SoundTab);
		await fireEvent.keyDown(screen.getByPlaceholderText('Press key'), { key: 'q' });
		const alert = screen.getByRole('alert');
		expect(alert).toBeInTheDocument();
		expect(alert.textContent).toContain('"q" is reserved');
	});

	it('closes toast when close button clicked', async () => {
		render(SoundTab);
		await fireEvent.keyDown(screen.getByPlaceholderText('Press key'), { key: 'q' });
		expect(screen.getByRole('alert')).toBeInTheDocument();
		await fireEvent.click(screen.getByLabelText('Close'));
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('shows warning toast when key is already bound to another note', async () => {
		// Two chips — bind 'a' to chip 1, then try to bind 'a' to chip 2
		const chip1 = new MockSoundChip('kick', 1, 100, 0, 'kick.wav');
		const chip2 = new MockSoundChip('snare', 2, 100, 0, 'snare.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip1, chip2]);
				return () => {};
			}
		);
		render(SoundTab);

		const keyInputs = screen.getAllByPlaceholderText('Press key');
		// Bind 'a' to the first chip
		await fireEvent.keyDown(keyInputs[0], { key: 'a' });
		// Try to bind 'a' again to the second chip — should show warning
		await fireEvent.keyDown(keyInputs[1], { key: 'a' });
		const alert = screen.getByRole('alert');
		expect(alert).toBeInTheDocument();
		expect(alert.textContent).toContain('"a" is already bound');
	});

	it('updates chip label via input change', async () => {
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		const labelInput = document.querySelector(
			'input[type="text"]:not([placeholder])'
		) as HTMLInputElement;
		await fireEvent.change(labelInput, { target: { value: 'snare' } });
		// chip.label should be updated
		expect(chip.label).toBe('snare');
	});

	it('updates chip volume via input change', async () => {
		const chip = new MockSoundChip('kick', 1, 80, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		const inputs = document.querySelectorAll('input[type="number"]');
		await fireEvent.change(inputs[0], { target: { value: '90' } });
		expect(chip.volume).toBe(90);
	});

	it('updates chip position via input change', async () => {
		const chip = new MockSoundChip('kick', 1, 100, 0, 'kick.wav');
		mockStore.currentSoundChip.subscribe.mockImplementation(
			(cb: (v: MockSoundChip[]) => void) => {
				cb([chip]);
				return () => {};
			}
		);
		render(SoundTab);
		const inputs = document.querySelectorAll('input[type="number"]');
		await fireEvent.change(inputs[1], { target: { value: '5' } });
		expect(chip.position).toBe(5);
	});
});
