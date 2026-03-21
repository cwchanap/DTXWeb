import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { get } from 'svelte/store';
import { Preview } from './Preview';
import { LaneMeasureNote } from '../../chart/note';

type MockedFn = ReturnType<typeof vi.fn>;

// Mock the store module that Preview.ts imports
const mockStore = vi.hoisted(() => ({
	playSpeed: {
		subscribe: vi.fn((callback) => {
			callback(1);
			return { unsubscribe: vi.fn() };
		})
	},
	currentSoundChip: {
		subscribe: vi.fn((callback) => {
			callback([]);
			return { unsubscribe: vi.fn() };
		})
	}
}));

vi.mock('../../store', () => ({
	default: mockStore
}));

vi.mock('$lib/browser/audioDecoder', () => ({
	XAaudioContext: vi.fn()
}));

vi.mock('../utils', () => ({
	getAssetPath: vi.fn().mockReturnValue('test/path')
}));

// Mock file provider
vi.mock('../../services/fileProvider', () => ({
	getFileProvider: vi.fn(() => ({
		getFile: vi.fn(),
		setFile: vi.fn(),
		removeFile: vi.fn(),
		clear: vi.fn(),
		generateKey: vi.fn(),
		getKeys: vi.fn()
	}))
}));

// Mock EventBus
vi.mock('../EventBus', () => ({
	EventBus: {
		emit: vi.fn(),
		on: vi.fn(),
		off: vi.fn()
	}
}));

describe('Preview Scene', () => {
	let previewScene: Preview;

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks();

		// Reset the specific mock functions we'll be checking
		mockStore.playSpeed.subscribe.mockClear();
		mockStore.currentSoundChip.subscribe.mockClear();

		// Create a new instance of Preview
		previewScene = new Preview();

		// Mock URL.createObjectURL
		global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	it('should initialize with correct properties', () => {
		expect(previewScene).toBeDefined();
		expect(previewScene.constructor.name).toBe('Preview');
		expect(Preview.key).toBe('Preview');
		expect(Preview.bgmNoteID).toBe('01');
		expect(Preview.bpmNoteID).toBe('08');
	});

	it('should initialize data correctly', () => {
		const testData = {
			measureCount: 10,
			notes: { '01': [] },
			bpm: 120,
			bpmNotes: { '08': 120 },
			startMeasure: 0
		};

		previewScene.init(testData);

		expect(previewScene['measureCount']).toBe(10);
		expect(previewScene['notes']).toEqual({ '01': [] });
		expect(previewScene['bpm']).toBe(120);
		expect(previewScene['bpmNotes']).toEqual({ '08': 120 });
		expect(previewScene['startMeasure']).toBe(0);
		expect(mockStore.playSpeed.subscribe).toHaveBeenCalled();
	});

	it('should handle play speed changes correctly', () => {
		// Setup
		const testData = {
			measureCount: 10,
			notes: { '01': [] },
			bpm: 120,
			bpmNotes: { '08': 120 },
			startMeasure: 0
		};

		// Initialize with test data
		previewScene.init(testData);

		// Get the callback function directly from the mock
		const subscribeCallback = mockStore.playSpeed.subscribe.mock.calls[0][0];

		// Call the callback with a new play speed
		subscribeCallback(2);

		// Verify the play speed was updated
		expect(previewScene['playSpeed']).toBe(2);
	});

	it('should seek new tween to previous elapsed time on play speed change', () => {
		const testData = {
			measureCount: 10,
			notes: { '01': [] },
			bpm: 120,
			bpmNotes: { '08': 120 },
			startMeasure: 0
		};

		previewScene.init(testData);

		const subscribeCallback = mockStore.playSpeed.subscribe.mock.calls[0][0];
		const oldTween = { elapsed: 1500 } as any;
		const newTween = { seek: vi.fn() } as any;

		previewScene['previewTween'] = oldTween;

		const createPreviewTweenSpy = vi
			.spyOn(previewScene as any, 'createPreviewTween')
			.mockImplementation(() => {
				previewScene['previewTween'] = newTween;
				return newTween;
			});

		try {
			subscribeCallback(2);

			expect(createPreviewTweenSpy).toHaveBeenCalled();
			expect(newTween.seek).toHaveBeenCalledWith(1500);
		} finally {
			createPreviewTweenSpy.mockRestore();
		}
	});

	it('should not seek when previous elapsed time is not finite', () => {
		const testData = {
			measureCount: 10,
			notes: { '01': [] },
			bpm: 120,
			bpmNotes: { '08': 120 },
			startMeasure: 0
		};

		previewScene.init(testData);

		const subscribeCallback = mockStore.playSpeed.subscribe.mock.calls[0][0];
		const oldTween = { elapsed: Number.NaN } as any;
		const newTween = { seek: vi.fn() } as any;

		previewScene['previewTween'] = oldTween;

		const createPreviewTweenSpy = vi
			.spyOn(previewScene as any, 'createPreviewTween')
			.mockImplementation(() => {
				previewScene['previewTween'] = newTween;
				return newTween;
			});

		try {
			subscribeCallback(2);

			expect(createPreviewTweenSpy).toHaveBeenCalled();
			expect(newTween.seek).not.toHaveBeenCalled();
		} finally {
			createPreviewTweenSpy.mockRestore();
		}
	});

	it('should not recreate tween when no preview tween exists', () => {
		const testData = {
			measureCount: 10,
			notes: { '01': [] },
			bpm: 120,
			bpmNotes: { '08': 120 },
			startMeasure: 0
		};

		previewScene.init(testData);

		const subscribeCallback = mockStore.playSpeed.subscribe.mock.calls[0][0];
		const createPreviewTweenSpy = vi.spyOn(previewScene as any, 'createPreviewTween');

		try {
			previewScene['previewTween'] = null;
			subscribeCallback(2);

			expect(createPreviewTweenSpy).not.toHaveBeenCalled();
		} finally {
			createPreviewTweenSpy.mockRestore();
		}
	});

	it('should load assets in preload', () => {
		previewScene.preload();
		expect(previewScene.load.spritesheet).toHaveBeenCalled();
		expect(previewScene.load.image).toHaveBeenCalled();
	});

	describe('pausePreview via boundStopPreview', () => {
		it('should stop preview tween if it exists', () => {
			const mockTween = { pause: vi.fn(), stop: vi.fn(), destroy: vi.fn() };
			previewScene['previewTween'] = mockTween as any;

			previewScene['boundStopPreview']();

			expect(mockTween.pause).toHaveBeenCalled();
		});

		it('should clear playing audio when paused', () => {
			const mockAudio = { stop: vi.fn() };
			previewScene['playingAudio'] = [mockAudio as any];

			previewScene['boundStopPreview']();

			expect(mockAudio.stop).toHaveBeenCalled();
			expect(previewScene['playingAudio']).toHaveLength(0);
		});

		it('should remove all timed events when paused', () => {
			previewScene['boundStopPreview']();
			expect(previewScene.time.removeAllEvents).toHaveBeenCalled();
		});

		it('should handle null previewTween without errors', () => {
			previewScene['previewTween'] = null;
			expect(() => previewScene['boundStopPreview']()).not.toThrow();
		});
	});

	describe('boundResumePreview', () => {
		it('should update startMeasure and invoke startPreviewWithoutSoundReload when called with data', () => {
			const startPreviewWithoutSoundReloadSpy = vi
				.spyOn(previewScene as any, 'startPreviewWithoutSoundReload')
				.mockImplementation(() => {});

			previewScene['boundResumePreview']({ startMeasure: 5 });

			expect(previewScene['startMeasure']).toBe(5);
			expect(startPreviewWithoutSoundReloadSpy).toHaveBeenCalled();
			startPreviewWithoutSoundReloadSpy.mockRestore();
		});
	});

	describe('getTimeElapsed', () => {
		const baseData = {
			measureCount: 5,
			notes: {},
			bpm: 120,
			bpmNotes: {},
			startMeasure: 0
		};

		it('should return 0 for measure 0 with no note offset', () => {
			previewScene.init(baseData);
			expect(previewScene.getTimeElapsed(0)).toBe(0);
		});

		it('should calculate time for a single measure at 120 BPM (2 seconds)', () => {
			previewScene.init(baseData);
			// At 120 BPM: secondsPerMeasure = 60 * 4 / 120 = 2 seconds
			expect(previewScene.getTimeElapsed(1)).toBeCloseTo(2, 5);
		});

		it('should calculate time for multiple measures', () => {
			previewScene.init(baseData);
			// 3 measures at 120 BPM = 6 seconds
			expect(previewScene.getTimeElapsed(3)).toBeCloseTo(6, 5);
		});

		it('should cache results and not recompute on repeated calls', () => {
			previewScene.init(baseData);
			const firstCall = previewScene.getTimeElapsed(2);
			const cache = (previewScene as any)['timeElapsedCache'] as Map<number, number>;
			expect(cache.has(2)).toBe(true);
			const cacheSizeAfterFirst = cache.size;
			const secondCall = previewScene.getTimeElapsed(2);
			expect(secondCall).toBe(firstCall);
			expect(cache.size).toBe(cacheSizeAfterFirst);
		});

		it('should calculate in-measure time when noteChipPosition is provided', () => {
			previewScene.init(baseData);
			// Half-way through measure 0 at 120 BPM = 1 second
			expect(previewScene.getTimeElapsed(0, 0.5)).toBeCloseTo(1, 5);
		});

		it('should not cache results when noteChipPosition is non-zero', () => {
			previewScene.init(baseData);
			// Prime the hash so validateCache won't call clear() during the spied call
			previewScene.getTimeElapsed(0);
			const cache = (previewScene as any)['timeElapsedCache'] as Map<number, number>;
			const getSpy = vi.spyOn(cache, 'get');
			const setSpy = vi.spyOn(cache, 'set');

			previewScene.getTimeElapsed(0, 0.25);

			// Cache must not be read from or written to for non-zero noteChipPosition
			expect(getSpy).not.toHaveBeenCalled();
			expect(setSpy).not.toHaveBeenCalled();
		});

		it('should handle BPM changes within a measure via bpmNotes', () => {
			const dataWithBpmNote: typeof baseData = {
				...baseData,
				notes: {
					'08': [
						{
							measure: 0,
							measureLength: 1,
							notes: [{ noteID: 'bpm150', position: 0.5 }]
						} as any
					]
				},
				bpmNotes: { bpm150: 150 }
			};
			previewScene.init(dataWithBpmNote);
			// Measure 0 has BPM 120→150 at position 0.5:
			// first half:  (60/120) * 4 * 0.5 = 1.0s
			// second half: (60/150) * 4 * 0.5 = 0.8s
			// total elapsed to end of measure 0 = 1.8s
			const elapsed = previewScene.getTimeElapsed(1);
			expect(elapsed).toBeCloseTo(1.8, 5);
		});

		it('should invalidate cache when data changes', () => {
			previewScene.init(baseData);
			const originalTime = previewScene.getTimeElapsed(1);

			// Re-init with double the BPM; the hash change triggers natural cache invalidation
			previewScene.init({ ...baseData, bpm: 240 });

			const newTime = previewScene.getTimeElapsed(1);
			// At 240 BPM: 1 second per measure (half of 120 BPM)
			expect(newTime).toBeCloseTo(originalTime / 2, 5);
		});
	});

	describe('getTotalMeasureOffset', () => {
		it('should return 0 for measure 0', () => {
			previewScene.init({
				measureCount: 5,
				notes: {},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});
			expect(previewScene.getTotalMesaureOffest(0)).toBe(0);
		});

		it('should cache results and not recompute on repeated calls', () => {
			previewScene.init({
				measureCount: 5,
				notes: {},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});
			const first = previewScene.getTotalMesaureOffest(2);
			const cache = (previewScene as any)['measureOffsetCache'] as Map<number, number>;
			expect(cache.has(2)).toBe(true);
			const cacheSizeAfterFirst = cache.size;
			const second = previewScene.getTotalMesaureOffest(2);
			expect(second).toBe(first);
			expect(cache.size).toBe(cacheSizeAfterFirst);
		});
	});

	describe('getCacheKey', () => {
		it('should generate a lowercase cache key from soundChip fileName', () => {
			const soundChip = { id: 1, fileName: 'Drum.WAV' } as any;
			expect(previewScene.getCacheKey(soundChip)).toBe('soundchip_drum.wav');
		});

		it('should handle already lowercase filenames', () => {
			const soundChip = { id: 2, fileName: 'snare.wav' } as any;
			expect(previewScene.getCacheKey(soundChip)).toBe('soundchip_snare.wav');
		});

		it('should handle mixed-case filenames', () => {
			const soundChip = { id: 3, fileName: 'HiHat.ogg' } as any;
			expect(previewScene.getCacheKey(soundChip)).toBe('soundchip_hihat.ogg');
		});
	});

	describe('shutdown', () => {
		it('should stop and destroy previewTween when it exists', () => {
			const mockTween = { stop: vi.fn(), destroy: vi.fn(), pause: vi.fn() };
			previewScene['previewTween'] = mockTween as any;

			previewScene.shutdown();

			expect(mockTween.stop).toHaveBeenCalled();
			expect(mockTween.destroy).toHaveBeenCalled();
			expect(previewScene['previewTween']).toBeNull();
		});

		it('should stop all playing audio on shutdown', () => {
			const mockAudio1 = { stop: vi.fn() };
			const mockAudio2 = { stop: vi.fn() };
			previewScene['playingAudio'] = [mockAudio1 as any, mockAudio2 as any];

			previewScene.shutdown();

			expect(mockAudio1.stop).toHaveBeenCalled();
			expect(mockAudio2.stop).toHaveBeenCalled();
			expect(previewScene['playingAudio']).toHaveLength(0);
		});

		it('should call time.removeAllEvents on shutdown', () => {
			previewScene.shutdown();
			expect(previewScene.time.removeAllEvents).toHaveBeenCalled();
		});

		it('should call storeUnsubscribe and null it out when set', () => {
			const unsubscribeFn = vi.fn();
			previewScene['storeUnsubscribe'] = unsubscribeFn;

			previewScene.shutdown();

			expect(unsubscribeFn).toHaveBeenCalled();
			expect(previewScene['storeUnsubscribe']).toBeNull();
		});

		it('should remove EventBus event listeners', () => {
			previewScene.shutdown();
			expect(EventBus.off).toHaveBeenCalledWith(
				EventType.STOP_PREVIEW,
				previewScene['boundStopPreview']
			);
			expect(EventBus.off).toHaveBeenCalledWith(
				EventType.RESUME_PREVIEW,
				previewScene['boundResumePreview']
			);
		});

		it('should reset isInitialized to false', () => {
			previewScene['isInitialized'] = true;
			previewScene.shutdown();
			expect(previewScene['isInitialized']).toBe(false);
		});

		it('should handle null previewTween without errors', () => {
			previewScene['previewTween'] = null;
			expect(() => previewScene.shutdown()).not.toThrow();
		});

		it('should reset container scales when containers exist', () => {
			const mockGridContainer = { setScale: vi.fn() };
			const mockNotesContainer = { setScale: vi.fn() };
			previewScene['gridContainer'] = mockGridContainer as any;
			previewScene['notesContainer'] = mockNotesContainer as any;

			previewScene.shutdown();

			expect(mockGridContainer.setScale).toHaveBeenCalledWith(1);
			expect(mockNotesContainer.setScale).toHaveBeenCalledWith(1);
		});
	});

	describe('cleanUp', () => {
		it('should call pausePreview when cleanUp is called', () => {
			const pauseSpy = vi
				.spyOn(previewScene as any, 'pausePreview')
				.mockImplementation(() => {});
			previewScene.cleanUp();
			expect(pauseSpy).toHaveBeenCalled();
			pauseSpy.mockRestore();
		});
	});

	describe('getCellHeight', () => {
		const baseData = {
			measureCount: 5,
			notes: {},
			bpm: 120,
			bpmNotes: {},
			startMeasure: 0
		};

		it('should return scaled cellHeight when no bpm notes exist', () => {
			previewScene.init(baseData);
			// referenceBPM=120, bpm=120 → scale=1 → returns cellHeight
			const result = previewScene.getCellHeight(0, 0);
			expect(result).toBeCloseTo(previewScene['cellHeight'], 5);
		});

		it('should return half cellHeight at double BPM', () => {
			previewScene.init({ ...baseData, bpm: 240 });
			// referenceBPM=120, bpm=240 → scale=0.5
			const result = previewScene.getCellHeight(0, 0);
			expect(result).toBeCloseTo(previewScene['cellHeight'] * 0.5, 5);
		});

		it('should use bpm from a previous measure bpm note', () => {
			previewScene.init({
				...baseData,
				bpm: 120,
				notes: {
					'08': [
						{
							measure: 0,
							measureLength: 1,
							notes: [{ noteID: 'bpm200', position: 0 }]
						} as any
					]
				},
				bpmNotes: { bpm200: 200 }
			});
			// measure 1, cell 0 — BPM change in previous measure 0 sets BPM to 200
			const result = previewScene.getCellHeight(1, 0);
			// referenceBPM=120, currentBPM=200 → scale = 120/200 = 0.6
			expect(result).toBeCloseTo(previewScene['cellHeight'] * (120 / 200), 5);
		});

		it('should use bpm from a current measure bpm note before the current cell', () => {
			const cellsPerMeasure = previewScene['cellsPerMeasure'];
			previewScene.init({
				...baseData,
				bpm: 120,
				notes: {
					'08': [
						{
							measure: 0,
							measureLength: 1,
							notes: [{ noteID: 'bpm180', position: 0.25 }]
						} as any
					]
				},
				bpmNotes: { bpm180: 180 }
			});
			// cell at position 0.5 * cellsPerMeasure is after the bpm change at position 0.25
			const cellAfterChange = Math.floor(0.5 * cellsPerMeasure);
			const result = previewScene.getCellHeight(0, cellAfterChange);
			// After BPM change: currentBPM = 180, scale = 120/180 ≈ 0.667
			expect(result).toBeCloseTo(previewScene['cellHeight'] * (120 / 180), 5);
		});
	});

	describe('getZoomOffset', () => {
		it('should return 0 when scale is 1', () => {
			expect(previewScene['getZoomOffset'](1)).toBe(0);
		});

		it('should return offsetY * (scale - 1) for arbitrary scale', () => {
			const offsetY = previewScene['offsetY'];
			expect(previewScene['getZoomOffset'](2)).toBeCloseTo(offsetY, 5);
		});

		it('should return negative value for sub-1 scale', () => {
			const result = previewScene['getZoomOffset'](0.5);
			expect(result).toBeLessThan(0);
		});
	});

	describe('audioBufferToWavBlob', () => {
		it('should return a Blob of type audio/wav', () => {
			const mockAudioBuffer = {
				numberOfChannels: 1,
				length: 4,
				sampleRate: 44100,
				getChannelData: vi.fn().mockReturnValue(new Float32Array([0, 0.5, -0.5, 1]))
			} as unknown as AudioBuffer;

			const result = previewScene['audioBufferToWavBlob'](mockAudioBuffer);
			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe('audio/wav');
		});

		it('should produce correct WAV byte size for stereo audio', () => {
			const frames = 10;
			const channels = 2;
			const mockAudioBuffer = {
				numberOfChannels: channels,
				length: frames,
				sampleRate: 44100,
				getChannelData: vi.fn().mockReturnValue(new Float32Array(frames).fill(0))
			} as unknown as AudioBuffer;

			const result = previewScene['audioBufferToWavBlob'](mockAudioBuffer);
			// Expected size = frames * channels * 2 (bytes per sample) + 44 (header)
			expect(result.size).toBe(frames * channels * 2 + 44);
		});

		it('should clamp audio samples to [-1, 1] range without throwing', () => {
			const mockAudioBuffer = {
				numberOfChannels: 1,
				length: 3,
				sampleRate: 44100,
				getChannelData: vi.fn().mockReturnValue(new Float32Array([2.0, -2.0, 0.5]))
			} as unknown as AudioBuffer;

			expect(() => previewScene['audioBufferToWavBlob'](mockAudioBuffer)).not.toThrow();
		});
	});

	describe('drawNote', () => {
		beforeEach(() => {
			// Set up notesContainer mock for Preview.drawNote
			previewScene['notesContainer'] = { add: vi.fn() } as any;
			previewScene['measureLength'] = [1];

			// Provide a getTotalMesaureOffest spy (Preview overrides it with caching)
			vi.spyOn(previewScene, 'getTotalMesaureOffest').mockReturnValue(0);
			vi.spyOn(previewScene, 'getCellHeight').mockReturnValue(25);
		});

		it('should return false for a non-playable lane config', () => {
			// laneConfigs in Preview are already filtered to playable, but we can
			// patch one to not be playable to test the early-return branch
			const originalConfigs = previewScene['laneConfigs'];
			previewScene['laneConfigs'] = [
				{ id: 'BPM', name: 'BPM', noteColor: 0, playable: false }
			] as any;

			const result = previewScene.drawNote(0, 0, 0, '08');
			expect(result).toBe(false);

			previewScene['laneConfigs'] = originalConfigs;
		});

		it('should create container and sprites when note does not exist', () => {
			// children.getByName returns falsy (note not existing)
			previewScene.children.getByName = vi.fn().mockReturnValue(null);

			const result = previewScene.drawNote(0, 0, 0, '1A');

			expect(result).toBe(true);
			expect(previewScene.add.container).toHaveBeenCalled();
			expect(previewScene.add.sprite).toHaveBeenCalled();
			expect((previewScene['notesContainer'] as any).add).toHaveBeenCalled();
		});

		it('should destroy existing note and return false when note already exists', () => {
			const destroyFn = vi.fn();
			const fakeNote = { destroy: destroyFn };
			previewScene.children.getByName = vi.fn().mockReturnValue(fakeNote);
			previewScene.children.getAll = vi.fn().mockReturnValue([fakeNote]);

			const result = previewScene.drawNote(0, 0, 0, '1A');

			expect(destroyFn).toHaveBeenCalled();
			expect(result).toBe(false);
		});
	});

	describe('cache management', () => {
		it('should validate cache and update lastDataHash', () => {
			previewScene.init({
				measureCount: 5,
				notes: {},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});
			// Initially no hash stored
			expect(previewScene['lastDataHash']).toBe('');

			// validateCache should update the hash
			previewScene['validateCache']();
			expect(previewScene['lastDataHash']).not.toBe('');
			expect(previewScene['calculationsValid']).toBe(true);
		});

		it('should invalidate cache when called', () => {
			previewScene.init({
				measureCount: 5,
				notes: {},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});

			previewScene['validateCache']();
			expect(previewScene['calculationsValid']).toBe(true);

			previewScene['invalidateCache']();
			expect(previewScene['calculationsValid']).toBe(false);
			expect(previewScene['lastDataHash']).toBe('');
		});

		it('should reinvalidate cache when data hash changes', () => {
			previewScene.init({
				measureCount: 5,
				notes: {},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});

			previewScene['validateCache']();
			const firstHash = previewScene['lastDataHash'];

			// Change BPM (which changes the hash)
			previewScene['bpm'] = 200;

			previewScene['validateCache']();
			const secondHash = previewScene['lastDataHash'];

			expect(firstHash).not.toBe(secondHash);
		});
	});
});
