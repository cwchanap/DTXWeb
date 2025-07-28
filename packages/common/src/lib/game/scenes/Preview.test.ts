import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { get } from 'svelte/store';
import store from '$lib/store';
import { Preview } from './Preview';
import { LaneMeasureNote } from '../../chart/note.js';

type MockedFn = ReturnType<typeof vi.fn>;

vi.mock('$lib/store', () => ({
	default: {
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
	}
}));

vi.mock('$lib/browser/audioDecoder', () => ({
	XAaudioContext: vi.fn()
}));

vi.mock('../utils', () => ({
	getAssetPath: vi.fn().mockReturnValue('test/path')
}));

describe('Preview Scene', () => {
	let previewScene: Preview;

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks();

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
		expect(store.playSpeed.subscribe).toHaveBeenCalled();
	});

	it('should preload assets', () => {
		// Mock store.currentSoundChip
		(get as MockedFn).mockReturnValue([
			{ fileName: 'test.wav', file: new File([], 'test.wav'), id: 1 },
			{ fileName: 'test.xa', file: new File([], 'test.xa'), id: 2 }
		]);

		previewScene.preload();

		expect(previewScene.load.audio).toHaveBeenCalled();
		expect(previewScene.load.spritesheet).toHaveBeenCalled();
		expect(previewScene.load.image).toHaveBeenCalled();
		expect(URL.createObjectURL).toHaveBeenCalled();
	});

	it('should create scene elements', () => {
		// Mock store.currentSoundChip
		(get as MockedFn).mockReturnValue([
			{ fileName: 'test.wav', file: new File([], 'test.wav'), id: 1 }
		]);

		// Mock methods that will be called
		previewScene.createNoteAnimations = vi.fn();
		previewScene.drawPanel = vi.fn();
		previewScene.drawNotes = vi.fn();
		previewScene.startPreview = vi.fn();

		previewScene.create();

		expect(previewScene.createNoteAnimations).toHaveBeenCalled();
		expect(previewScene.drawPanel).toHaveBeenCalled();
		expect(previewScene.drawNotes).toHaveBeenCalled();
		expect(previewScene.startPreview).toHaveBeenCalled();
		expect(EventBus.emit).toHaveBeenCalledWith(EventType.SCENE_READY, previewScene);
		expect(EventBus.on).toHaveBeenCalledTimes(2);
	});

	it('should clean up resources', () => {
		previewScene['panelContainer'] = previewScene.add.container(0, 0);
		previewScene['previewTween'] = previewScene.tweens.add({
			targets: previewScene['panelContainer'],
			y: 100,
			duration: 1000
		});

		const previewTween = previewScene['previewTween'];

		previewScene.cleanUp();

		expect(previewScene['previewTween']).toBeNull();
		expect(previewTween.stop).toHaveBeenCalled();
		expect(previewTween.destroy).toHaveBeenCalled();
		expect(previewScene['playingAudio']).toEqual([]);
		expect(previewScene.time.removeAllEvents).toHaveBeenCalled();
	});

	it('should start preview correctly', () => {
		// Setup test data
		previewScene['startMeasure'] = 0;
		previewScene['bpm'] = 120;
		previewScene['notes'] = {
			'01': [new LaneMeasureNote(0, '01', LaneMeasureNote.parseFromPattern('0102'), 1)],
			'11': [new LaneMeasureNote(1, '11', LaneMeasureNote.parseFromPattern('0102'), 1)]
		};
		previewScene['panelContainer'] = previewScene.add.container(0, 0);

		// Mock methods
		previewScene.updateCameraZoom = vi.fn();
		previewScene.createPreviewTween = vi.fn();
		previewScene.scheduleBGMPlayback = vi.fn();
		previewScene.scheduleNotePlayback = vi.fn();

		previewScene.startPreview();

		expect(previewScene.updateCameraZoom).toHaveBeenCalled();
		expect(previewScene.createPreviewTween).toHaveBeenCalled();
		expect(previewScene.scheduleBGMPlayback).toHaveBeenCalled();
		expect(previewScene.scheduleNotePlayback).toHaveBeenCalled();
	});

	it('should create preview tween correctly', () => {
		// Setup test data
		previewScene['startMeasure'] = 0;
		previewScene['measureCount'] = 10;
		previewScene['playSpeed'] = 1;
		previewScene['panelContainer'] = previewScene.add.container(0, 0);

		// Mock cameras.main.height for cameraScaleOffset calculation
		previewScene.cameras = {
			main: {
				height: 600
			}
		} as any;

		// Mock methods
		previewScene.getTotalMesaureOffest = vi
			.fn()
			.mockReturnValueOnce(100) // First call for startMeasure
			.mockReturnValueOnce(500); // Second call for measureCount
		previewScene.getTimeElapsed = vi
			.fn()
			.mockReturnValueOnce(10) // First call for measureCount
			.mockReturnValueOnce(0); // Second call for startMeasure

		const result = previewScene.createPreviewTween(0);

		expect(previewScene.getTotalMesaureOffest).toHaveBeenCalledTimes(2);
		expect(previewScene.getTimeElapsed).toHaveBeenCalledTimes(2);
		expect(previewScene.getTimeElapsed).toHaveBeenCalledWith(10);
		expect(previewScene.getTimeElapsed).toHaveBeenCalledWith(0);
		expect(previewScene.tweens.add).toHaveBeenCalledWith(
			expect.objectContaining({
				duration: 10000, // (10 - 0) * 1000 = 10 seconds in ms
				ease: 'Linear',
				repeat: -1,
				repeatDelay: 0,
				holdDelayedCalls: false,
				yoyo: false
			})
		);
		expect(result).toBe(previewScene['previewTween']);
	});

	it('should update camera zoom based on play speed', () => {
		// Setup
		previewScene['playSpeed'] = 2;
		previewScene['gridContainer'] = previewScene.add.container(0, 0);
		previewScene['notesContainer'] = previewScene.add.container(0, 0);

		previewScene.updateCameraZoom();

		expect(previewScene['gridContainer'].setScale).toHaveBeenCalledWith(1, 2);
		expect(previewScene['notesContainer'].setScale).toHaveBeenCalledWith(1, 2);
	});

	it('should handle play speed changes', () => {
		// Setup
		const testData = {
			measureCount: 10,
			notes: { '01': [] },
			bpm: 120,
			bpmNotes: { '08': 120 },
			startMeasure: 0
		};
		previewScene.updateCameraZoom = vi.fn();
		previewScene.createPreviewTween = vi.fn();
		previewScene['panelContainer'] = previewScene.add.container(0, 0);
		previewScene['panelContainer'].y = 100;
		previewScene['previewTween'] = previewScene.tweens.add({
			targets: previewScene['panelContainer'],
			y: 100,
			duration: 1000
		});

		// Initialize with test data
		previewScene.init(testData);

		// Get the callback function directly from the mock
		const subscribeCallback = (store.playSpeed.subscribe as MockedFn).mock.calls[0][0];

		// Call the callback with a new play speed
		subscribeCallback(2);

		// Verify the play speed was updated
		expect(previewScene['playSpeed']).toBe(2);
		expect(previewScene.updateCameraZoom).toHaveBeenCalled();
		expect(previewScene.createPreviewTween).toHaveBeenCalledWith(200); // 100 * 2
	});

	it('should calculate time elapsed correctly', () => {
		// Setup
		previewScene['bpm'] = 120;
		previewScene['measureLength'] = [1, 1, 1];

		// Create proper LaneMeasureNote instances with parsed notes
		const bpmNote = new LaneMeasureNote(
			1,
			'08',
			[
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 0.5 }
			],
			1
		);

		previewScene['notes'] = {
			'08': [bpmNote]
		};
		previewScene['bpmNotes'] = { '01': 60, '02': 180 };

		// Test time calculation for a complete measure
		const timeForMeasure0 = previewScene.getTimeElapsed(1);
		expect(timeForMeasure0).toBeCloseTo(2); // 60 seconds / 120 BPM * 4 beats = 2 seconds

		// Test time calculation with position within a measure
		const timeWithPosition = previewScene.getTimeElapsed(1, 0.5);
		expect(timeWithPosition).toBeGreaterThan(timeForMeasure0);
	});

	it('should schedule BGM playback with volume', () => {
		// Setup
		const mockSoundChip = {
			id: 1,
			volume: 75,
			fileName: 'bgm.wav',
			file: new File([], 'bgm.wav')
		};
		(get as MockedFn).mockReturnValue([mockSoundChip]);

		const mockAudio = { play: vi.fn() };
		previewScene.sound.get = vi.fn().mockReturnValue(mockAudio);
		previewScene.getCacheKey = vi.fn().mockReturnValue('test-cache-key');
		previewScene.getTimeElapsed = vi
			.fn()
			.mockReturnValueOnce(2) // getTimeElapsed(0, 0) - note time
			.mockReturnValueOnce(0); // getTimeElapsed(0) - start time

		const note = new LaneMeasureNote(0, '01', [{ noteID: '01', position: 0 }], 1);
		note.measureLength = 1;

		previewScene.scheduleBGMPlayback(note, 2, 0);

		// Trigger the delayed call immediately
		const delayedCall = previewScene.time.delayedCall as MockedFn;
		expect(delayedCall).toHaveBeenCalledWith(2000, expect.any(Function));

		// Execute the callback
		const callback = delayedCall.mock.calls[0][1];
		callback();

		// Verify volume is applied correctly (75/100 = 0.75)
		expect(mockAudio.play).toHaveBeenCalledWith({
			seek: 0,
			volume: 0.75
		});
	});

	it('should schedule note playback with volume', () => {
		// Setup - noteID '11' corresponds to chip id 17 (parseInt('11', 36) = 37, but let's use '01' for id 1)
		const mockSoundChip = {
			id: 1,
			volume: 60,
			fileName: 'hihat.wav',
			file: new File([], 'hihat.wav')
		};
		(get as MockedFn).mockReturnValue([mockSoundChip]);

		const mockAudio = { play: vi.fn() };
		previewScene.sound.get = vi.fn().mockReturnValue(mockAudio);
		previewScene.getCacheKey = vi.fn().mockReturnValue('test-cache-key');
		previewScene.getTimeElapsed = vi
			.fn()
			.mockReturnValueOnce(1) // getTimeElapsed(1, 0.5) - note time
			.mockReturnValueOnce(0); // getTimeElapsed(0) - start time

		const note = new LaneMeasureNote(1, '11', [{ noteID: '01', position: 0.5 }], 1);
		note.measureLength = 1;

		previewScene.scheduleNotePlayback(note, 2, 0);

		// Trigger the delayed call immediately
		const delayedCall = previewScene.time.delayedCall as MockedFn;
		expect(delayedCall).toHaveBeenCalledWith(1000, expect.any(Function));

		// Execute the callback
		const callback = delayedCall.mock.calls[0][1];
		callback();

		// Verify volume is applied correctly (60/100 = 0.6)
		expect(mockAudio.play).toHaveBeenCalledWith({
			volume: 0.6
		});
	});

	it('should handle zero volume correctly', () => {
		// Setup
		const mockSoundChip = {
			id: 1,
			volume: 0,
			fileName: 'silent.wav',
			file: new File([], 'silent.wav')
		};
		(get as MockedFn).mockReturnValue([mockSoundChip]);

		const mockAudio = { play: vi.fn() };
		previewScene.sound.get = vi.fn().mockReturnValue(mockAudio);
		previewScene.getCacheKey = vi.fn().mockReturnValue('test-cache-key');
		previewScene.getTimeElapsed = vi.fn().mockReturnValue(0);

		const note = new LaneMeasureNote(0, '01', [{ noteID: '01', position: 0 }], 1);
		note.measureLength = 1;

		previewScene.scheduleBGMPlayback(note, 2, 0);

		// Execute the callback
		const callback = (previewScene.time.delayedCall as MockedFn).mock.calls[0][1];
		callback();

		// Verify zero volume is applied correctly (0/100 = 0)
		expect(mockAudio.play).toHaveBeenCalledWith({
			seek: 0,
			volume: 0
		});
	});

	it('should handle maximum volume correctly', () => {
		// Setup
		const mockSoundChip = {
			id: 1,
			volume: 100,
			fileName: 'loud.wav',
			file: new File([], 'loud.wav')
		};
		(get as MockedFn).mockReturnValue([mockSoundChip]);

		const mockAudio = { play: vi.fn() };
		previewScene.sound.get = vi.fn().mockReturnValue(mockAudio);
		previewScene.getCacheKey = vi.fn().mockReturnValue('test-cache-key');
		previewScene.getTimeElapsed = vi
			.fn()
			.mockReturnValueOnce(1) // getTimeElapsed(1, 0) - note time
			.mockReturnValueOnce(0); // getTimeElapsed(0) - start time

		const note = new LaneMeasureNote(1, '11', [{ noteID: '01', position: 0 }], 1);
		note.measureLength = 1;

		previewScene.scheduleNotePlayback(note, 2, 0);

		// Trigger the delayed call immediately
		const delayedCall = previewScene.time.delayedCall as MockedFn;
		expect(delayedCall).toHaveBeenCalledWith(1000, expect.any(Function));

		// Execute the callback
		const callback = delayedCall.mock.calls[0][1];
		callback();

		// Verify maximum volume is applied correctly (100/100 = 1)
		expect(mockAudio.play).toHaveBeenCalledWith({
			volume: 1
		});
	});

	it('should draw notes correctly', () => {
		// Setup
		previewScene['laneConfigs'] = [
			{ id: '11', name: 'Test Lane', noteColor: 0xff0000, playable: true, width: 48 }
		];
		previewScene['notesContainer'] = previewScene.add.container(0, 0);

		// Mock getters
		Object.defineProperty(previewScene, 'offsetX', { get: () => 100 });
		Object.defineProperty(previewScene, 'offsetY', { get: () => 500 });

		// Set protected properties
		previewScene['cellWidth'] = 50;
		previewScene['cellMargin'] = 2;

		// Mock methods
		previewScene.getTotalMesaureOffest = vi.fn().mockReturnValue(100);
		previewScene.getCellHeight = vi.fn().mockReturnValue(25);

		// Call the method
		previewScene.drawNote(0, 0, 0.5, '11');

		// Verify container and sprites were created
		expect(previewScene.add.container).toHaveBeenCalled();
		expect(previewScene.add.sprite).toHaveBeenCalledTimes(2); // Base and overlay sprites
		expect(previewScene['notesContainer'].add).toHaveBeenCalled();
	});
});

// Add tests for EventBus event handlers
describe('Preview Scene Event Handlers', () => {
	let previewScene: Preview;

	beforeEach(() => {
		vi.clearAllMocks();
		previewScene = new Preview();

		// Mock anims property to prevent errors
		previewScene.anims = {
			exists: vi.fn().mockReturnValue(false),
			remove: vi.fn(),
			create: vi.fn()
		} as any;

		// Mock methods
		previewScene.cleanUp = vi.fn();
		previewScene.startPreview = vi.fn();
	});

	it('should handle STOP_PREVIEW event', () => {
		// Mock the anims methods first
		const mockCleanUp = vi.fn();
		previewScene.cleanUp = mockCleanUp;

		// Get the callback function for STOP_PREVIEW
		previewScene.create();
		const stopPreviewCallback = ((EventBus.on as MockedFn)?.mock.calls.find(
			(call) => call[0] === EventType.STOP_PREVIEW
		) || [])[1];

		// Call the callback
		stopPreviewCallback();

		// Verify cleanUp was called
		expect(mockCleanUp).toHaveBeenCalled();
	});

	it('should handle RESUME_PREVIEW event', () => {
		// Mock the anims methods first
		const mockStartPreview = vi.fn();
		previewScene.startPreview = mockStartPreview;

		// Get the callback function for RESUME_PREVIEW
		previewScene.create();
		const resumePreviewCallback = ((EventBus.on as MockedFn).mock.calls.find(
			(call) => call[0] === EventType.RESUME_PREVIEW
		) || [])[1];

		// Call the callback with data
		const testData = { startMeasure: 5 };
		resumePreviewCallback(testData);

		// Verify startMeasure was updated and startPreview was called
		expect(previewScene['startMeasure']).toBe(5);
		expect(mockStartPreview).toHaveBeenCalled();
	});
});
