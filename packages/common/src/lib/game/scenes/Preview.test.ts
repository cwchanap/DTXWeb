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
});
