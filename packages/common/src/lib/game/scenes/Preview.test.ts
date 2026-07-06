import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { get } from 'svelte/store';
import { Preview } from './Preview';
import { LaneMeasureNote } from '../../chart/note';
import { XAaudioContext } from '$lib/browser/audioDecoder';
import { getFileProvider } from '../../services/fileProvider';

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
			const cellsPerMeasure = previewScene['cellsPerMeasure'];
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

		it('should calculate cellsYOffset using whole cells and fractional cell (non-zero offset)', () => {
			// cellOffset = 7/24 → wholeCells=4, fractionalCell≈0.667 → covers loop + fractional branch
			previewScene.children.getByName = vi.fn().mockReturnValue(null);

			const result = previewScene.drawNote(0, 1, 7 / 24, '1A');

			expect(result).toBe(true);
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

	describe('create()', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.runAllTimers();
			vi.useRealTimers();
		});

		it('should set up containers, draw panel/notes, and emit SCENE_READY', async () => {
			(previewScene['scene'] as any).isActive = vi.fn().mockReturnValue(false);
			// Reset static flag so createNoteAnimations branch is exercised
			(Preview as any).animationsCreated = false;

			const createNoteAnimationsSpy = vi
				.spyOn(previewScene as any, 'createNoteAnimations')
				.mockImplementation(() => {});
			const drawPanelSpy = vi
				.spyOn(previewScene as any, 'drawPanel')
				.mockImplementation(() => {});
			const drawNotesSpy = vi
				.spyOn(previewScene as any, 'drawNotes')
				.mockImplementation(() => {});
			const setupSoundsSpy = vi
				.spyOn(previewScene as any, 'setupSoundsAsync')
				.mockResolvedValue(undefined);
			const startPreviewSpy = vi
				.spyOn(previewScene as any, 'startPreview')
				.mockImplementation(() => {});

			await previewScene.create();

			expect(createNoteAnimationsSpy).toHaveBeenCalled();
			expect((Preview as any).animationsCreated).toBe(true);
			expect(drawPanelSpy).toHaveBeenCalled();
			expect(drawNotesSpy).toHaveBeenCalled();
			expect(setupSoundsSpy).toHaveBeenCalled();
			expect(startPreviewSpy).toHaveBeenCalled();
			expect(previewScene['isInitialized']).toBe(true);
			expect(EventBus.emit).toHaveBeenCalledWith(EventType.SCENE_READY, previewScene);
			expect(EventBus.on).toHaveBeenCalledWith(EventType.STOP_PREVIEW, expect.any(Function));
			expect(EventBus.on).toHaveBeenCalledWith(
				EventType.RESUME_PREVIEW,
				expect.any(Function)
			);

			createNoteAnimationsSpy.mockRestore();
			drawPanelSpy.mockRestore();
			drawNotesSpy.mockRestore();
			setupSoundsSpy.mockRestore();
			startPreviewSpy.mockRestore();
		});

		it('should skip createNoteAnimations when animationsCreated is already true', async () => {
			(previewScene['scene'] as any).isActive = vi.fn().mockReturnValue(false);
			(Preview as any).animationsCreated = true;

			const createNoteAnimationsSpy = vi
				.spyOn(previewScene as any, 'createNoteAnimations')
				.mockImplementation(() => {});
			const drawPanelSpy = vi
				.spyOn(previewScene as any, 'drawPanel')
				.mockImplementation(() => {});
			const drawNotesSpy = vi
				.spyOn(previewScene as any, 'drawNotes')
				.mockImplementation(() => {});
			const setupSoundsSpy = vi
				.spyOn(previewScene as any, 'setupSoundsAsync')
				.mockResolvedValue(undefined);
			const startPreviewSpy = vi
				.spyOn(previewScene as any, 'startPreview')
				.mockImplementation(() => {});

			await previewScene.create();

			expect(createNoteAnimationsSpy).not.toHaveBeenCalled();

			createNoteAnimationsSpy.mockRestore();
			drawPanelSpy.mockRestore();
			drawNotesSpy.mockRestore();
			setupSoundsSpy.mockRestore();
			startPreviewSpy.mockRestore();
		});

		it('removes EventBus handlers when Phaser emits DESTROY (game.destroy path)', async () => {
			// Phaser's game.destroy() emits DESTROY on the scene's event emitter
			// but never calls scene.shutdown(). The DESTROY listener registered in
			// create() must remove the EventBus handlers so they do not leak.
			// Mock limitation: __mocks__/phaser.ts EventEmitter uses no-op vi.fn()s
			// for once/emit/off, so this test manually invokes the captured DESTROY
			// callback rather than driving a real emit. This verifies the callback
			// calls removeEventBusListeners(), but cannot verify Phaser actual
			// emit-vs-removeAllListeners ordering (Systems.destroy emits DESTROY
			// THEN calls removeAllListeners). Correct for Phaser 3.88 today; if
			// Phaser reorders, this test would not catch the regression.
			(previewScene['scene'] as any).isActive = vi.fn().mockReturnValue(false);
			(Preview as any).animationsCreated = true;

			vi.spyOn(previewScene as any, 'drawPanel').mockImplementation(() => {});
			vi.spyOn(previewScene as any, 'drawNotes').mockImplementation(() => {});
			vi.spyOn(previewScene as any, 'setupSoundsAsync').mockResolvedValue(undefined);
			vi.spyOn(previewScene as any, 'startPreview').mockImplementation(() => {});

			await previewScene.create();

			// Simulate Phaser's Systems.destroy() firing the DESTROY listener
			// registered via this.events.once(Phaser.Scenes.Events.DESTROY, ...).
			const onceMock = previewScene.events.once as unknown as MockedFn;
			const destroyListener = onceMock.mock.calls.find(
				(call: unknown[]) => call[0] === 'destroy'
			)?.[1];
			expect(destroyListener).toEqual(expect.any(Function));
			(destroyListener as (() => void) | undefined)?.();

			expect(EventBus.off).toHaveBeenCalledWith(
				EventType.STOP_PREVIEW,
				previewScene['boundStopPreview']
			);
			expect(EventBus.off).toHaveBeenCalledWith(
				EventType.RESUME_PREVIEW,
				previewScene['boundResumePreview']
			);
		});

		it('removes EventBus handlers when Phaser emits SHUTDOWN (scene.stop path)', async () => {
			// scene.stop() (e.g. difficulty switching in DesktopEditor) calls
			// sys.shutdown() which emits SHUTDOWN but never emits DESTROY and never
			// re-runs the constructor. The SHUTDOWN listener registered in the
			// constructor must remove the EventBus handlers so they do not leak
			// across stop/start cycles (each create() re-adds them).
			(previewScene['scene'] as any).isActive = vi.fn().mockReturnValue(false);
			(Preview as any).animationsCreated = true;

			vi.spyOn(previewScene as any, 'drawPanel').mockImplementation(() => {});
			vi.spyOn(previewScene as any, 'drawNotes').mockImplementation(() => {});
			vi.spyOn(previewScene as any, 'setupSoundsAsync').mockResolvedValue(undefined);
			vi.spyOn(previewScene as any, 'startPreview').mockImplementation(() => {});

			await previewScene.create();

			// Simulate Phaser's Systems.shutdown() firing the SHUTDOWN listener
			// registered via this.events.on(Phaser.Scenes.Events.SHUTDOWN, ...).
			const onMock = previewScene.events.on as unknown as MockedFn;
			const shutdownListener = onMock.mock.calls.find(
				(call: unknown[]) => call[0] === 'shutdown'
			)?.[1];
			expect(shutdownListener).toEqual(expect.any(Function));
			(shutdownListener as (() => void) | undefined)?.();

			expect(EventBus.off).toHaveBeenCalledWith(
				EventType.STOP_PREVIEW,
				previewScene['boundStopPreview']
			);
			expect(EventBus.off).toHaveBeenCalledWith(
				EventType.RESUME_PREVIEW,
				previewScene['boundResumePreview']
			);
		});
	});

	describe('updateData()', () => {
		it('should update all fields, invalidate cache, and redraw', () => {
			const mockContainer = { removeAll: vi.fn(), add: vi.fn() };
			previewScene['gridContainer'] = mockContainer as any;
			previewScene['notesContainer'] = mockContainer as any;
			previewScene['panelContainer'] = mockContainer as any;

			const drawGridLinesSpy = vi
				.spyOn(previewScene as any, 'drawGridLines')
				.mockImplementation(() => {});
			const drawNotesSpy = vi
				.spyOn(previewScene as any, 'drawNotes')
				.mockImplementation(() => {});
			const startPreviewSpy = vi
				.spyOn(previewScene as any, 'startPreview')
				.mockImplementation(() => {});
			const parseMeasureLengthSpy = vi
				.spyOn(previewScene as any, 'parseMesaureLength')
				.mockImplementation(() => {});

			previewScene.updateData({
				bpm: 140,
				bpmNotes: { '08': 200 },
				notes: { '01': [] },
				measureCount: 8,
				startMeasure: 2
			});

			expect(previewScene['bpm']).toBe(140);
			expect(previewScene['measureCount']).toBe(8);
			expect(previewScene['startMeasure']).toBe(2);
			expect(mockContainer.removeAll).toHaveBeenCalled();
			expect(drawGridLinesSpy).toHaveBeenCalled();
			expect(drawNotesSpy).toHaveBeenCalled();
			expect(startPreviewSpy).toHaveBeenCalled();

			drawGridLinesSpy.mockRestore();
			drawNotesSpy.mockRestore();
			startPreviewSpy.mockRestore();
			parseMeasureLengthSpy.mockRestore();
		});

		it('should work when panelContainer is undefined', () => {
			const mockContainer = { removeAll: vi.fn(), add: vi.fn() };
			previewScene['gridContainer'] = mockContainer as any;
			previewScene['notesContainer'] = mockContainer as any;
			previewScene['panelContainer'] = undefined as any;

			const drawGridLinesSpy = vi
				.spyOn(previewScene as any, 'drawGridLines')
				.mockImplementation(() => {});
			const drawNotesSpy = vi
				.spyOn(previewScene as any, 'drawNotes')
				.mockImplementation(() => {});
			const startPreviewSpy = vi
				.spyOn(previewScene as any, 'startPreview')
				.mockImplementation(() => {});
			const parseMeasureLengthSpy = vi
				.spyOn(previewScene as any, 'parseMesaureLength')
				.mockImplementation(() => {});

			expect(() =>
				previewScene.updateData({
					bpm: 120,
					bpmNotes: {},
					notes: {},
					measureCount: 5,
					startMeasure: 0
				})
			).not.toThrow();

			drawGridLinesSpy.mockRestore();
			drawNotesSpy.mockRestore();
			startPreviewSpy.mockRestore();
			parseMeasureLengthSpy.mockRestore();
		});
	});

	describe('setupSoundsAsync()', () => {
		it('should return early when soundChips is null', async () => {
			// Configure the store subscribe to return null for currentSoundChip
			mockStore.currentSoundChip.subscribe.mockImplementationOnce(
				(callback: (v: null) => void) => {
					callback(null);
					return { unsubscribe: vi.fn() };
				}
			);
			await expect(previewScene['setupSoundsAsync']()).resolves.toBeUndefined();
		});

		it('should return early when all sound chips are already loaded', async () => {
			const mockSoundChips = [{ fileName: 'kick.wav' }];
			mockStore.currentSoundChip.subscribe.mockImplementationOnce(
				(callback: (v: typeof mockSoundChips) => void) => {
					callback(mockSoundChips);
					return { unsubscribe: vi.fn() };
				}
			);

			// Mock cache.audio.exists to return true (already loaded)
			(previewScene['cache'] as any) = {
				audio: { exists: vi.fn().mockReturnValue(true) }
			};
			(previewScene['sound'] as any).get = vi.fn().mockReturnValue({});

			await expect(previewScene['setupSoundsAsync']()).resolves.toBeUndefined();
		});

		it('should load unloaded sound chips via fileProvider', async () => {
			const mockSoundChips = [{ fileName: 'kick.wav', id: 1 }];
			const mockFile = new File(['audio'], 'kick.wav', { type: 'audio/wav' });
			const mockGetFile = vi.fn().mockResolvedValue(mockFile);

			// Use subscribe mock to return sound chips via get()
			mockStore.currentSoundChip.subscribe.mockImplementationOnce(
				(callback: (v: typeof mockSoundChips) => void) => {
					callback(mockSoundChips);
					return { unsubscribe: vi.fn() };
				}
			);

			// Cache not loaded
			(previewScene['cache'] as any) = {
				audio: { exists: vi.fn().mockReturnValue(false), remove: vi.fn() }
			};
			(previewScene['sound'] as any).get = vi.fn().mockReturnValue(null);

			// fileProvider returns the file
			vi.mocked(getFileProvider).mockReturnValueOnce({ getFile: mockGetFile } as any);

			// load.once triggers callback immediately to resolve promise
			(previewScene.load.once as ReturnType<typeof vi.fn>).mockImplementation(
				(_event: string, callback: () => void) => {
					callback();
				}
			);

			await previewScene['setupSoundsAsync']();

			expect(previewScene.load.audio).toHaveBeenCalled();
		});

		it('should use global sound cache when processed entry exists for XA file', async () => {
			const mockSoundChips = [{ fileName: 'kick.xa', id: 1 }];
			const mockFile = new File([new Uint8Array(4)], 'kick.xa');
			const cachedBlob = new Blob(['wav'], { type: 'audio/wav' });
			const cacheKey = 'soundchip_kick.xa';
			const mockGetFile = vi.fn().mockResolvedValue(mockFile);

			mockStore.currentSoundChip.subscribe.mockImplementationOnce(
				(callback: (v: typeof mockSoundChips) => void) => {
					callback(mockSoundChips);
					return { unsubscribe: vi.fn() };
				}
			);

			// Cache not loaded in Phaser
			(previewScene['cache'] as any) = {
				audio: { exists: vi.fn().mockReturnValue(false), remove: vi.fn() }
			};
			(previewScene['sound'] as any).get = vi.fn().mockReturnValue(null);

			// Set up global sound cache with a processed entry (XA path uses cachedBlob)
			Preview['soundCacheMap'].set(cacheKey, { blob: cachedBlob, processed: true });

			vi.mocked(getFileProvider).mockReturnValueOnce({ getFile: mockGetFile } as any);

			(previewScene.load.once as ReturnType<typeof vi.fn>).mockImplementation(
				(_event: string, callback: () => void) => {
					callback();
				}
			);

			await previewScene['setupSoundsAsync']();

			expect(URL.createObjectURL).toHaveBeenCalledWith(cachedBlob);

			// Clean up global cache
			Preview['soundCacheMap'].delete(cacheKey);
		});

		it('should handle null file from fileProvider gracefully', async () => {
			const mockSoundChips = [{ fileName: 'missing.wav', id: 2 }];
			const mockGetFile = vi.fn().mockResolvedValue(null);

			mockStore.currentSoundChip.subscribe.mockImplementationOnce(
				(callback: (v: typeof mockSoundChips) => void) => {
					callback(mockSoundChips);
					return { unsubscribe: vi.fn() };
				}
			);

			(previewScene['cache'] as any) = {
				audio: { exists: vi.fn().mockReturnValue(false), remove: vi.fn() }
			};
			(previewScene['sound'] as any).get = vi.fn().mockReturnValue(null);
			vi.mocked(getFileProvider).mockReturnValueOnce({ getFile: mockGetFile } as any);

			await expect(previewScene['setupSoundsAsync']()).resolves.toBeUndefined();
		});

		it('should handle fileProvider.getFile throwing an error', async () => {
			const mockSoundChips = [{ fileName: 'error.wav', id: 3 }];
			const mockGetFile = vi.fn().mockRejectedValue(new Error('file not found'));

			mockStore.currentSoundChip.subscribe.mockImplementationOnce(
				(callback: (v: typeof mockSoundChips) => void) => {
					callback(mockSoundChips);
					return { unsubscribe: vi.fn() };
				}
			);

			(previewScene['cache'] as any) = {
				audio: { exists: vi.fn().mockReturnValue(false), remove: vi.fn() }
			};
			(previewScene['sound'] as any).get = vi.fn().mockReturnValue(null);
			vi.mocked(getFileProvider).mockReturnValueOnce({ getFile: mockGetFile } as any);

			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			await expect(previewScene['setupSoundsAsync']()).resolves.toBeUndefined();

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to setup sound chip'),
				expect.any(Error)
			);
			warnSpy.mockRestore();
		});
	});

	describe('create() setTimeout subscription', () => {
		afterEach(() => {
			vi.runAllTimers();
			vi.useRealTimers();
		});

		it('should subscribe to currentSoundChip after 100ms when scene is active', async () => {
			vi.useFakeTimers();

			await previewScene.create();

			(previewScene['scene'] as any).isActive = vi.fn().mockReturnValue(true);
			const setupSoundsAsyncSpy = vi
				.spyOn(previewScene as any, 'setupSoundsAsync')
				.mockResolvedValue(undefined);

			// Advance past the 100ms setTimeout
			vi.advanceTimersByTime(200);

			expect(previewScene['storeUnsubscribe']).toBeDefined();

			setupSoundsAsyncSpy.mockRestore();
		});

		it('should not subscribe when scene is not active after 100ms', async () => {
			vi.useFakeTimers();

			await previewScene.create();

			(previewScene['scene'] as any).isActive = vi.fn().mockReturnValue(false);

			vi.advanceTimersByTime(200);

			expect(previewScene['storeUnsubscribe']).toBeFalsy();
		});
	});

	describe('updateCameraZoom()', () => {
		it('should scale gridContainer and notesContainer by playSpeed', () => {
			const mockObj = { setScale: vi.fn() };
			const mockGridContainer = {
				setScale: vi.fn(),
				getAll: vi.fn().mockReturnValue([mockObj])
			};
			const mockNotesContainer = {
				setScale: vi.fn(),
				getAll: vi.fn().mockReturnValue([mockObj])
			};
			previewScene['gridContainer'] = mockGridContainer as any;
			previewScene['notesContainer'] = mockNotesContainer as any;
			previewScene['playSpeed'] = 1.5;

			previewScene.updateCameraZoom();

			expect(mockGridContainer.setScale).toHaveBeenCalledWith(1, 1.5);
			expect(mockNotesContainer.setScale).toHaveBeenCalledWith(1, 1.5);
		});

		it('should handle missing gridContainer and notesContainer gracefully', () => {
			previewScene['gridContainer'] = undefined as any;
			previewScene['notesContainer'] = undefined as any;

			expect(() => previewScene.updateCameraZoom()).not.toThrow();
		});
	});

	describe('createPreviewTween()', () => {
		const baseData = {
			measureCount: 5,
			notes: {},
			bpm: 120,
			bpmNotes: {},
			startMeasure: 0
		};

		it('should create a new tween and return it', () => {
			previewScene.init(baseData);
			previewScene['panelContainer'] = { setPosition: vi.fn(), y: 0 } as any;

			const result = previewScene.createPreviewTween();

			expect(previewScene.tweens.add).toHaveBeenCalled();
			expect(result).toBeDefined();
		});

		it('should stop and destroy existing tween before creating a new one', () => {
			previewScene.init(baseData);
			previewScene['panelContainer'] = { setPosition: vi.fn(), y: 0 } as any;

			const oldTween = { stop: vi.fn(), destroy: vi.fn() };
			previewScene['previewTween'] = oldTween as any;

			previewScene.createPreviewTween();

			expect(oldTween.stop).toHaveBeenCalled();
			expect(oldTween.destroy).toHaveBeenCalled();
		});

		it('should accept a custom startY parameter', () => {
			previewScene.init(baseData);
			const mockContainer = { setPosition: vi.fn(), y: 0 };
			previewScene['panelContainer'] = mockContainer as any;

			previewScene.createPreviewTween(100);

			expect(mockContainer.setPosition).toHaveBeenCalledWith(0, 100);
		});
	});

	describe('startPreview()', () => {
		it('should call setupSoundsAsync and then startPreviewWithoutSoundReload', async () => {
			const setupSoundsSpy = vi
				.spyOn(previewScene as any, 'setupSoundsAsync')
				.mockResolvedValue(undefined);
			const startSpy = vi
				.spyOn(previewScene as any, 'startPreviewWithoutSoundReload')
				.mockImplementation(() => {});

			previewScene.startPreview();
			await vi.waitFor(() => expect(startSpy).toHaveBeenCalled());

			setupSoundsSpy.mockRestore();
			startSpy.mockRestore();
		});
	});

	describe('startPreviewWithoutSoundReload()', () => {
		const baseData = {
			measureCount: 5,
			notes: {},
			bpm: 120,
			bpmNotes: {},
			startMeasure: 0
		};

		it('should call updateCameraZoom and createPreviewTween', () => {
			previewScene.init(baseData);
			previewScene['panelContainer'] = { setPosition: vi.fn(), y: 0 } as any;

			const updateCameraZoomSpy = vi
				.spyOn(previewScene as any, 'updateCameraZoom')
				.mockImplementation(() => {});
			const createPreviewTweenSpy = vi
				.spyOn(previewScene as any, 'createPreviewTween')
				.mockImplementation(() => {});

			previewScene['startPreviewWithoutSoundReload']();

			expect(updateCameraZoomSpy).toHaveBeenCalled();
			expect(createPreviewTweenSpy).toHaveBeenCalled();

			updateCameraZoomSpy.mockRestore();
			createPreviewTweenSpy.mockRestore();
		});

		it('should stop and clear existing previewTween before starting', () => {
			previewScene.init(baseData);
			previewScene['panelContainer'] = { setPosition: vi.fn(), y: 0 } as any;

			const oldTween = { stop: vi.fn(), destroy: vi.fn() };
			previewScene['previewTween'] = oldTween as any;

			const createPreviewTweenSpy = vi
				.spyOn(previewScene as any, 'createPreviewTween')
				.mockImplementation(() => {});
			const updateCameraZoomSpy = vi
				.spyOn(previewScene as any, 'updateCameraZoom')
				.mockImplementation(() => {});

			previewScene['startPreviewWithoutSoundReload']();

			expect(oldTween.stop).toHaveBeenCalled();
			expect(oldTween.destroy).toHaveBeenCalled();
			expect(previewScene['previewTween']).toBeNull();

			createPreviewTweenSpy.mockRestore();
			updateCameraZoomSpy.mockRestore();
		});

		it('should stop playing audio and clear timed events', () => {
			previewScene.init(baseData);
			previewScene['panelContainer'] = { setPosition: vi.fn(), y: 0 } as any;

			const mockAudio = { stop: vi.fn() };
			previewScene['playingAudio'] = [mockAudio as any];

			const createPreviewTweenSpy = vi
				.spyOn(previewScene as any, 'createPreviewTween')
				.mockImplementation(() => {});
			const updateCameraZoomSpy = vi
				.spyOn(previewScene as any, 'updateCameraZoom')
				.mockImplementation(() => {});

			previewScene['startPreviewWithoutSoundReload']();

			expect(mockAudio.stop).toHaveBeenCalled();
			expect(previewScene['playingAudio']).toHaveLength(0);
			expect(previewScene.time.removeAllEvents).toHaveBeenCalled();

			createPreviewTweenSpy.mockRestore();
			updateCameraZoomSpy.mockRestore();
		});
	});

	describe('drawPanel()', () => {
		it('should create panelContainer and set up the grid hierarchy', () => {
			previewScene['gridContainer'] = previewScene.add.container(0, 0) as any;
			previewScene['notesContainer'] = previewScene.add.container(0, 0) as any;
			previewScene.init({
				measureCount: 2,
				notes: {},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});

			expect(() => previewScene.drawPanel()).not.toThrow();
			expect(previewScene['panelContainer']).toBeDefined();
		});
	});

	describe('drawGridLines()', () => {
		it('should add graphic objects to gridContainer without throwing', () => {
			const mockGridContainer = { add: vi.fn(), setScale: vi.fn() };
			previewScene['gridContainer'] = mockGridContainer as any;
			previewScene.init({
				measureCount: 2,
				notes: {},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});

			expect(() => previewScene.drawGridLines()).not.toThrow();
			expect(mockGridContainer.add).toHaveBeenCalled();
		});
	});

	describe('createNoteAnimations()', () => {
		const playableLaneConfigs = [
			{
				name: 'HHC',
				noteColor: 0x0d1cde,
				id: '11',
				playable: true,
				iconFrameIndex: 1,
				width: 48
			},
			{
				name: 'SN',
				noteColor: 0xefec1b,
				id: '12',
				playable: true,
				iconFrameIndex: 4,
				width: 64
			},
			{
				name: 'BD',
				noteColor: 0x567dcb,
				id: '13',
				playable: true,
				iconFrameIndex: 8,
				width: 70
			}
		];

		beforeEach(() => {
			// Set preview scene lane configs to a controlled subset
			previewScene['laneConfigs'] = playableLaneConfigs as any;
			// Reset animationsCreated flag to allow createNoteAnimations to run
			(Preview as any).animationsCreated = false;
		});

		it('should call textures.get with DRUM_CHIPS asset name', () => {
			previewScene['createNoteAnimations']();
			expect(previewScene.textures.get).toHaveBeenCalledWith('drum-chips');
		});

		it('should check for and remove existing animations for each playable lane', () => {
			(previewScene.anims.exists as ReturnType<typeof vi.fn>).mockReturnValue(true);

			previewScene['createNoteAnimations']();

			// For each playable lane, both base and overlay keys should be checked
			const existsCalls = (previewScene.anims.exists as ReturnType<typeof vi.fn>).mock.calls;
			expect(existsCalls.length).toBe(playableLaneConfigs.length * 2);

			// Should check for base and overlay keys for each lane
			for (const lane of playableLaneConfigs) {
				expect(previewScene.anims.exists).toHaveBeenCalledWith(`note-${lane.id}-base`);
				expect(previewScene.anims.exists).toHaveBeenCalledWith(`note-${lane.id}-overlay`);
			}
		});

		it('should remove existing animations when they exist', () => {
			(previewScene.anims.exists as ReturnType<typeof vi.fn>).mockReturnValue(true);

			previewScene['createNoteAnimations']();

			for (const lane of playableLaneConfigs) {
				expect(previewScene.anims.remove).toHaveBeenCalledWith(`note-${lane.id}-base`);
				expect(previewScene.anims.remove).toHaveBeenCalledWith(`note-${lane.id}-overlay`);
			}
		});

		it('should not call remove when animations do not exist', () => {
			(previewScene.anims.exists as ReturnType<typeof vi.fn>).mockReturnValue(false);

			previewScene['createNoteAnimations']();

			expect(previewScene.anims.remove).not.toHaveBeenCalled();
		});

		it('should add 11 texture frames per playable lane', () => {
			const mockTexture = { add: vi.fn() };
			(previewScene.textures.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTexture);

			previewScene['createNoteAnimations']();

			// 11 frames (rows 0-10) per lane
			expect(mockTexture.add).toHaveBeenCalledTimes(playableLaneConfigs.length * 11);
		});

		it('should create base and overlay animations for each playable lane', () => {
			previewScene['createNoteAnimations']();

			// 2 animations per lane (base + overlay)
			expect(previewScene.anims.create).toHaveBeenCalledTimes(playableLaneConfigs.length * 2);
		});

		it('should create base animation with correct frameRate and repeat settings', () => {
			previewScene['createNoteAnimations']();

			const animCalls = (previewScene.anims.create as ReturnType<typeof vi.fn>).mock.calls;
			const baseAnimCalls = animCalls.filter(([config]) =>
				(config as { key: string }).key.endsWith('-base')
			);

			for (const [config] of baseAnimCalls) {
				expect(config.frameRate).toBe(12);
				expect(config.repeat).toBe(-1);
				expect(config.frames).toHaveLength(8); // frames 2-9
			}
		});

		it('should create overlay animation with correct frameRate and repeat settings', () => {
			previewScene['createNoteAnimations']();

			const animCalls = (previewScene.anims.create as ReturnType<typeof vi.fn>).mock.calls;
			const overlayAnimCalls = animCalls.filter(([config]) =>
				(config as { key: string }).key.endsWith('-overlay')
			);

			for (const [config] of overlayAnimCalls) {
				expect(config.frameRate).toBe(8);
				expect(config.repeat).toBe(-1);
				expect(config.frames).toHaveLength(3); // frames 0, 1, 10
			}
		});

		it('should skip non-playable lanes and lanes without width', () => {
			previewScene['laneConfigs'] = [
				{ name: 'BPM', noteColor: 0x000000, id: '08', playable: false },
				{ name: 'HHC', noteColor: 0x0d1cde, id: '11', playable: true, width: 48 },
				{ name: 'NW', noteColor: 0xffffff, id: '99', playable: true } // no width
			] as any;

			previewScene['createNoteAnimations']();

			// Only '11' should have animations created (BPM is not playable, '99' has no width)
			expect(previewScene.anims.create).toHaveBeenCalledTimes(2); // base + overlay for '11' only
		});

		it('should calculate correct texture frame x positions based on note order', () => {
			const mockTexture = { add: vi.fn() };
			(previewScene.textures.get as ReturnType<typeof vi.fn>).mockReturnValue(mockTexture);

			// Set laneConfigs to match the known noteOrder to test x position calculation
			previewScene['laneConfigs'] = [
				{ name: 'BD', noteColor: 0x567dcb, id: '13', playable: true, width: 70 }, // first in noteOrder
				{ name: 'RD', noteColor: 0x14bfc4, id: '19', playable: true, width: 58 } // second in noteOrder
			] as any;

			previewScene['createNoteAnimations']();

			const textureCalls = mockTexture.add.mock.calls;
			// '13' should start at x=0
			const bd13Calls = textureCalls.filter(([frameName]) =>
				(frameName as string).startsWith('13_')
			);
			expect(bd13Calls[0][2]).toBe(0); // xPosition for '13' (first in noteOrder)

			// '19' should start at x=70 (after '13' width=70)
			const rd19Calls = textureCalls.filter(([frameName]) =>
				(frameName as string).startsWith('19_')
			);
			expect(rd19Calls[0][2]).toBe(70); // xPosition for '19'
		});
	});

	describe('createPreviewTween', () => {
		let mockContainer: { setPosition: ReturnType<typeof vi.fn> };

		beforeEach(() => {
			mockContainer = { setPosition: vi.fn() };
			previewScene['panelContainer'] = mockContainer as any;
			vi.spyOn(previewScene as any, 'getZoomOffset').mockReturnValue(10);
			vi.spyOn(previewScene, 'getTotalMesaureOffest').mockReturnValue(500);
			vi.spyOn(previewScene, 'getTimeElapsed').mockReturnValue(5);
		});

		it('should call tweens.add and return the tween', () => {
			const result = previewScene.createPreviewTween();

			expect(previewScene.tweens.add).toHaveBeenCalled();
			expect(result).toBeDefined();
		});

		it('should set panelContainer position', () => {
			previewScene.createPreviewTween();

			expect(mockContainer.setPosition).toHaveBeenCalled();
		});

		it('should stop and destroy existing tween before creating new one', () => {
			const mockTween = { stop: vi.fn(), destroy: vi.fn() };
			previewScene['previewTween'] = mockTween as any;

			previewScene.createPreviewTween();

			expect(mockTween.stop).toHaveBeenCalled();
			expect(mockTween.destroy).toHaveBeenCalled();
		});

		it('should use provided startY when given', () => {
			previewScene.createPreviewTween(100);

			expect(mockContainer.setPosition).toHaveBeenCalledWith(0, 100);
		});

		it('should not throw when previewTween is null', () => {
			previewScene['previewTween'] = null;

			expect(() => previewScene.createPreviewTween()).not.toThrow();
		});

		it('should null out previewTween reference before creating new tween', () => {
			const mockTween = { stop: vi.fn(), destroy: vi.fn() };
			previewScene['previewTween'] = mockTween as any;

			previewScene.createPreviewTween();

			// After the destroy, previewTween should have been set to the new tween
			expect(previewScene['previewTween']).not.toBe(mockTween);
		});
	});

	describe('scheduleNotePlayback', () => {
		let mockNote: LaneMeasureNote;

		beforeEach(() => {
			mockNote = {
				measure: 0,
				measureLength: 2, // non-default value, so won't be reassigned
				notes: [
					{ noteID: '01', position: 0 },
					{ noteID: '02', position: 0.5 }
				]
			} as any;

			vi.spyOn(previewScene, 'getTimeElapsed').mockReturnValue(0);
		});

		it('should call time.delayedCall for notes with non-negative delay', () => {
			vi.spyOn(previewScene, 'getTimeElapsed')
				.mockReturnValueOnce(1) // noteAbsoluteTime > startTime → delay=1
				.mockReturnValueOnce(0); // startTime

			previewScene.scheduleNotePlayback(mockNote, 1, 0);

			expect(previewScene.time.delayedCall).toHaveBeenCalled();
		});

		it('should not schedule notes with negative delay', () => {
			vi.spyOn(previewScene, 'getTimeElapsed')
				.mockReturnValueOnce(0) // noteAbsoluteTime < startTime → delay<0
				.mockReturnValueOnce(1); // startTime → delay = -1

			previewScene.scheduleNotePlayback(
				{ ...mockNote, notes: [{ noteID: '01', position: 0 }] } as any,
				1,
				0
			);

			expect(previewScene.time.delayedCall).not.toHaveBeenCalled();
		});

		it('should update measureLength from array when default value of 1', () => {
			const noteWithDefault = { ...mockNote, measureLength: 1, measure: 0 };
			previewScene['measureLength'] = [3];

			previewScene.scheduleNotePlayback(noteWithDefault as any, 1, 0);

			expect(noteWithDefault.measureLength).toBe(3);
		});

		it('should keep measureLength as 1 if not in measureLength array', () => {
			const noteWithDefault = { ...mockNote, measureLength: 1, measure: 5 };
			previewScene['measureLength'] = []; // empty, measure 5 not defined

			previewScene.scheduleNotePlayback(noteWithDefault as any, 1, 0);

			expect(noteWithDefault.measureLength).toBe(1);
		});

		it('should not modify measureLength when it is not 1', () => {
			const note = { ...mockNote, measureLength: 2, measure: 0 };
			previewScene['measureLength'] = [4];

			previewScene.scheduleNotePlayback(note as any, 1, 0);

			expect(note.measureLength).toBe(2); // unchanged
		});

		it('should play audio when soundChip and audio found in cache', () => {
			const mockAudio = { play: vi.fn() };
			// id must match parseInt('1', 36) = 1
			const mockSoundChip = { id: 1, volume: 80, fileName: 'drum.wav' };

			// Configure mock store to return sound chip via get()
			mockStore.currentSoundChip.subscribe.mockImplementationOnce(
				(callback: (chips: any[]) => void) => {
					callback([mockSoundChip]);
					return { unsubscribe: vi.fn() };
				}
			);
			(previewScene.sound.get as ReturnType<typeof vi.fn>).mockReturnValue(mockAudio);

			vi.spyOn(previewScene, 'getTimeElapsed').mockReturnValue(0);
			vi.spyOn(previewScene, 'getCacheKey').mockReturnValue('soundchip_drum.wav');

			const note = {
				measure: 0,
				measureLength: 2,
				notes: [{ noteID: '1', position: 0 }]
			} as any;

			previewScene.scheduleNotePlayback(note, 1, 0);

			// Invoke the delayedCall callback to test the inner branch
			const delayedCallMock = previewScene.time.delayedCall as ReturnType<typeof vi.fn>;
			const callback = delayedCallMock.mock.calls[0]?.[1];
			callback?.();

			expect(mockAudio.play).toHaveBeenCalledWith({ volume: 0.8 });
			expect(previewScene['playingAudio']).toContain(mockAudio);
		});
	});

	describe('scheduleBGMPlayback', () => {
		it('should call time.delayedCall for BGM notes', () => {
			vi.spyOn(previewScene, 'getTimeElapsed').mockReturnValue(0);

			const note = {
				measure: 0,
				measureLength: 2,
				notes: [{ noteID: '01', position: 0 }]
			} as any;

			previewScene.scheduleBGMPlayback(note, 1, 0);

			expect(previewScene.time.delayedCall).toHaveBeenCalled();
		});

		it('should play audio with seek when soundChip and audio found in cache', () => {
			const mockAudio = { play: vi.fn() };
			const mockSoundChip = { id: 1, volume: 100, fileName: 'bgm.wav' };

			mockStore.currentSoundChip.subscribe.mockImplementationOnce(
				(callback: (chips: any[]) => void) => {
					callback([mockSoundChip]);
					return { unsubscribe: vi.fn() };
				}
			);
			(previewScene.sound.get as ReturnType<typeof vi.fn>).mockReturnValue(mockAudio);

			vi.spyOn(previewScene, 'getTimeElapsed').mockReturnValue(0);
			vi.spyOn(previewScene, 'getCacheKey').mockReturnValue('soundchip_bgm.wav');

			const note = {
				measure: 0,
				measureLength: 2,
				notes: [{ noteID: '1', position: 0 }]
			} as any;

			previewScene.scheduleBGMPlayback(note, 1, 0);

			const delayedCallMock = previewScene.time.delayedCall as ReturnType<typeof vi.fn>;
			const callback = delayedCallMock.mock.calls[0]?.[1];
			callback?.();

			expect(mockAudio.play).toHaveBeenCalledWith({ seek: 0, volume: 1 });
		});
	});

	describe('getCellHeight - break when BPM note is after current cell', () => {
		it('should not apply BPM change when note is after the current cell', () => {
			previewScene.init({
				measureCount: 5,
				notes: {
					'08': [
						{
							measure: 0,
							measureLength: 1,
							notes: [{ noteID: 'bpm240', position: 0.75 }]
						} as any
					]
				},
				bpm: 120,
				bpmNotes: { bpm240: 240 },
				startMeasure: 0
			});

			const cellsPerMeasure = previewScene['cellsPerMeasure'];
			// Request cell at position 0.25 which is BEFORE the BPM change at 0.75
			const cellBeforeChange = Math.floor(0.25 * cellsPerMeasure);
			const result = previewScene.getCellHeight(0, cellBeforeChange);

			// BPM note at 0.75 is after current cell, so break is hit
			// currentBPM stays at initial bpm=120, scale = 120/120 = 1
			expect(result).toBeCloseTo(previewScene['cellHeight'], 5);
		});
	});

	describe('getCellHeight - two BPM notes in the same measure', () => {
		it('should hit sort return 0 branch when two BPM notes share the same measure', () => {
			// Two BPM notes at measure 0 — the sort comparator returns 0 (same measure)
			previewScene.init({
				measureCount: 5,
				notes: {
					'08': [
						{
							measure: 0,
							measureLength: 1,
							notes: [{ noteID: 'bpm120', position: 0 }]
						} as any,
						{
							measure: 0,
							measureLength: 1,
							notes: [{ noteID: 'bpm200', position: 0.5 }]
						} as any
					]
				},
				bpm: 120,
				bpmNotes: { bpm120: 120, bpm200: 200 },
				startMeasure: 0
			});

			// Calling getCellHeight triggers the sort that returns 0 for same-measure notes
			const result = previewScene.getCellHeight(1, 0);
			// Both notes at measure 0, so after sorting (return 0 branch hit), last note applies
			expect(result).toBeGreaterThan(0);
		});
	});

	describe('scheduleBGMPlayback - measureLength update', () => {
		it('should update measureLength when note has default value of 1', () => {
			previewScene.init({
				measureCount: 5,
				notes: {},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});

			// Set measureLength array so measure 0 maps to length 3
			previewScene['measureLength'] = [3];

			const note = {
				measure: 0,
				measureLength: 1, // default value — should be updated
				notes: [{ noteID: '1', position: 0 }]
			} as any;

			vi.spyOn(previewScene, 'getTimeElapsed').mockReturnValue(0);
			previewScene.scheduleBGMPlayback(note, 1, 0);

			// measureLength should be updated from the array
			expect(note.measureLength).toBe(3);
		});
	});

	describe('startPreviewWithoutSoundReload - BGM and playable note scheduling', () => {
		it('should schedule BGM playback when notes[01] is non-empty', () => {
			previewScene.init({
				measureCount: 2,
				notes: {
					'01': [
						{
							measure: 0,
							measureLength: 2,
							notes: [{ noteID: '1', position: 0 }]
						} as any
					]
				},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});
			previewScene['panelContainer'] = { setPosition: vi.fn(), y: 0 } as any;

			const scheduleBGMSpy = vi
				.spyOn(previewScene as any, 'scheduleBGMPlayback')
				.mockImplementation(() => {});
			const createPreviewTweenSpy = vi
				.spyOn(previewScene as any, 'createPreviewTween')
				.mockImplementation(() => {});
			const updateCameraZoomSpy = vi
				.spyOn(previewScene as any, 'updateCameraZoom')
				.mockImplementation(() => {});

			previewScene['startPreviewWithoutSoundReload']();

			expect(scheduleBGMSpy).toHaveBeenCalled();

			scheduleBGMSpy.mockRestore();
			createPreviewTweenSpy.mockRestore();
			updateCameraZoomSpy.mockRestore();
		});

		it('should schedule note playback when playable lane notes are present', () => {
			// Use '1A' (LC) which is a playable lane
			previewScene.init({
				measureCount: 2,
				notes: {
					'1A': [
						{
							measure: 0,
							measureLength: 2,
							notes: [{ noteID: '01', position: 0 }]
						} as any
					]
				},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});
			previewScene['panelContainer'] = { setPosition: vi.fn(), y: 0 } as any;

			const scheduleNoteSpy = vi
				.spyOn(previewScene as any, 'scheduleNotePlayback')
				.mockImplementation(() => {});
			const createPreviewTweenSpy = vi
				.spyOn(previewScene as any, 'createPreviewTween')
				.mockImplementation(() => {});
			const updateCameraZoomSpy = vi
				.spyOn(previewScene as any, 'updateCameraZoom')
				.mockImplementation(() => {});

			previewScene['startPreviewWithoutSoundReload']();

			expect(scheduleNoteSpy).toHaveBeenCalled();

			scheduleNoteSpy.mockRestore();
			createPreviewTweenSpy.mockRestore();
			updateCameraZoomSpy.mockRestore();
		});
	});

	describe('getTimeElapsed - noteChipPosition with BPM changes', () => {
		it('should calculate time correctly when BPM changes before noteChipPosition', () => {
			previewScene.init({
				measureCount: 5,
				notes: {
					'08': [
						{
							measure: 0,
							measureLength: 1,
							notes: [{ noteID: 'bpm150', position: 0.25 }]
						} as any
					]
				},
				bpm: 120,
				bpmNotes: { bpm150: 150 },
				startMeasure: 0
			});
			// noteChipPosition=0.5 is past the BPM change at 0.25
			// first segment: (60/120)*4*0.25 = 0.5s
			// second segment: (60/150)*4*(0.5-0.25) = 0.4s
			const elapsed = previewScene.getTimeElapsed(0, 0.5);
			expect(elapsed).toBeCloseTo(0.9, 5);
		});

		it('should stop BPM segment calculation when note position exceeds noteChipPosition', () => {
			previewScene.init({
				measureCount: 5,
				notes: {
					'08': [
						{
							measure: 0,
							measureLength: 1,
							notes: [{ noteID: 'bpm200', position: 0.75 }]
						} as any
					]
				},
				bpm: 120,
				bpmNotes: { bpm200: 200 },
				startMeasure: 0
			});
			// noteChipPosition=0.5 is before the BPM change at 0.75
			// Only the range 0..0.5 at 120 BPM: (60/120)*4*0.5 = 1.0s
			// Then noteChipPosition > lastPosition (0.5 > 0), add remaining
			const elapsed = previewScene.getTimeElapsed(0, 0.5);
			expect(elapsed).toBeCloseTo(1.0, 5);
		});

		it('should skip notes with noteID "00" in BPM segment calculation', () => {
			previewScene.init({
				measureCount: 5,
				notes: {
					'08': [
						{
							measure: 0,
							measureLength: 1,
							notes: [{ noteID: '00', position: 0.25 }]
						} as any
					]
				},
				bpm: 120,
				bpmNotes: {},
				startMeasure: 0
			});
			// noteID '00' is skipped, so no BPM change happens
			// noteChipPosition=0.5 at 120 BPM: (60/120)*4*0.5 = 1.0s
			const elapsed = previewScene.getTimeElapsed(0, 0.5);
			expect(elapsed).toBeCloseTo(1.0, 5);
		});
	});

	describe('loadSoundChipAsync()', () => {
		it('should load non-XA audio file, call setupAudioListeners and load.start', async () => {
			const mockSoundChip = { fileName: 'kick.wav' } as any;
			const mockFile = new File(['audio'], 'kick.wav', { type: 'audio/wav' });
			const cacheKey = 'soundchip_kick.wav';

			// Make load.once call the callback immediately (simulating filecomplete)
			(previewScene.load.once as ReturnType<typeof vi.fn>).mockImplementation(
				(_event: string, callback: () => void) => {
					callback();
				}
			);
			(previewScene.sound.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

			await previewScene['loadSoundChipAsync'](mockFile, mockSoundChip, cacheKey);

			expect(previewScene.load.audio).toHaveBeenCalledWith(cacheKey, 'blob:mock-url');
			expect(previewScene.load.start).toHaveBeenCalled();
			expect(previewScene.sound.add).toHaveBeenCalledWith(cacheKey);
		});

		it('should load XA file using XAaudioContext.decodeAudioData when no cachedBlob', async () => {
			const mockSoundChip = { fileName: 'drum.xa' } as any;
			const mockFile = new File([new Uint8Array(4)], 'drum.xa', { type: 'audio/xa' });
			Object.defineProperty(mockFile, 'arrayBuffer', {
				value: vi.fn().mockResolvedValue(new ArrayBuffer(4))
			});
			const cacheKey = 'soundchip_drum.xa';
			const mockAudioBuffer = {
				numberOfChannels: 1,
				sampleRate: 44100,
				length: 100,
				getChannelData: vi.fn().mockReturnValue(new Float32Array(100))
			} as any;

			(XAaudioContext as any).decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);

			(previewScene.load.once as ReturnType<typeof vi.fn>).mockImplementation(
				(_event: string, callback: () => void) => {
					callback();
				}
			);
			(previewScene.sound.get as ReturnType<typeof vi.fn>).mockReturnValue({});

			await previewScene['loadSoundChipAsync'](mockFile, mockSoundChip, cacheKey);

			expect(previewScene.load.audio).toHaveBeenCalledWith(cacheKey, 'blob:mock-url');
		});

		it('should use cachedBlob when provided for XA file', async () => {
			const mockSoundChip = { fileName: 'snare.xa' } as any;
			const mockFile = new File([new Uint8Array(4)], 'snare.xa');
			const cacheKey = 'soundchip_snare.xa';
			const cachedBlob = new Blob(['wav-data'], { type: 'audio/wav' });

			(previewScene.load.once as ReturnType<typeof vi.fn>).mockImplementation(
				(_event: string, callback: () => void) => {
					callback();
				}
			);
			(previewScene.sound.get as ReturnType<typeof vi.fn>).mockReturnValue({});

			await previewScene['loadSoundChipAsync'](mockFile, mockSoundChip, cacheKey, cachedBlob);

			expect(URL.createObjectURL).toHaveBeenCalledWith(cachedBlob);
			expect(previewScene.load.audio).toHaveBeenCalledWith(cacheKey, 'blob:mock-url');
		});

		it('should resolve without loading when scene is not initialized', async () => {
			const mockSoundChip = { fileName: 'kick.wav' } as any;
			const mockFile = new File(['audio'], 'kick.wav');
			const cacheKey = 'soundchip_kick.wav';

			(previewScene as any).load = null;

			await expect(
				previewScene['loadSoundChipAsync'](mockFile, mockSoundChip, cacheKey)
			).resolves.toBeUndefined();
		});

		it('should resolve and log warning when XA decoding throws', async () => {
			const mockSoundChip = { fileName: 'bad.xa' } as any;
			const mockFile = new File([new Uint8Array(4)], 'bad.xa');
			Object.defineProperty(mockFile, 'arrayBuffer', {
				value: vi.fn().mockResolvedValue(new ArrayBuffer(4))
			});
			const cacheKey = 'soundchip_bad.xa';

			(XAaudioContext as any).decodeAudioData = vi
				.fn()
				.mockRejectedValue(new Error('decode failed'));

			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			await expect(
				previewScene['loadSoundChipAsync'](mockFile, mockSoundChip, cacheKey)
			).resolves.toBeUndefined();

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to decode XA file'),
				expect.any(Error)
			);
			warnSpy.mockRestore();
		});
	});

	describe('setupAudioListeners()', () => {
		it('should register filecomplete and loaderror listeners and set a timeout', () => {
			vi.useFakeTimers();
			const resolve = vi.fn();
			const cacheKey = 'soundchip_test.wav';

			(previewScene.load.once as ReturnType<typeof vi.fn>).mockImplementation(() => {});
			(previewScene.sound.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

			previewScene['setupAudioListeners'](cacheKey, resolve);

			expect(previewScene.load.once).toHaveBeenCalledWith(
				`filecomplete-audio-${cacheKey}`,
				expect.any(Function)
			);
			expect(previewScene.load.once).toHaveBeenCalledWith(
				`loaderror-audio-${cacheKey}`,
				expect.any(Function)
			);

			// Advance past the 10s timeout
			vi.advanceTimersByTime(11000);
			expect(resolve).toHaveBeenCalled();

			vi.useRealTimers();
		});

		it('should resolve and add sound on filecomplete when sound not yet in cache', () => {
			const resolve = vi.fn();
			const cacheKey = 'soundchip_test.wav';

			// Capture all handlers in order (filecomplete is registered twice)
			const allHandlers: Array<[string, (...args: unknown[]) => unknown]> = [];
			(previewScene.load.once as ReturnType<typeof vi.fn>).mockImplementation(
				(event: string, callback: (...args: unknown[]) => unknown) => {
					allHandlers.push([event, callback]);
				}
			);
			(previewScene.sound.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

			previewScene['setupAudioListeners'](cacheKey, resolve);

			// First filecomplete handler is the one that calls sound.add and resolve
			const firstFilecomplete = allHandlers.find(
				([event]) => event === `filecomplete-audio-${cacheKey}`
			)?.[1];
			firstFilecomplete?.();

			expect(previewScene.sound.add).toHaveBeenCalledWith(cacheKey);
			expect(resolve).toHaveBeenCalled();
		});

		it('should resolve on loaderror without adding sound', () => {
			const resolve = vi.fn();
			const cacheKey = 'soundchip_err.wav';

			const handlers: Record<string, (...args: unknown[]) => unknown> = {};
			(previewScene.load.once as ReturnType<typeof vi.fn>).mockImplementation(
				(event: string, callback: (...args: unknown[]) => unknown) => {
					handlers[event] = callback;
				}
			);

			previewScene['setupAudioListeners'](cacheKey, resolve);

			// Trigger loaderror
			handlers[`loaderror-audio-${cacheKey}`]?.({});

			expect(resolve).toHaveBeenCalled();
			expect(previewScene.sound.add).not.toHaveBeenCalled();
		});
	});
});
