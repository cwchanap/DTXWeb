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
		on: vi.fn()
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
