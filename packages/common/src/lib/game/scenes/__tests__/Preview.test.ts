import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Preview } from '../Preview.js';
import { LaneMeasureNote } from '../../../chart/note.js';

type MockedFn = ReturnType<typeof vi.fn>;

// Mock browser APIs
global.URL = {
	createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
	revokeObjectURL: vi.fn()
} as any;

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
	});

	it('should create scene elements', () => {
		// Mock methods that will be called
		previewScene.drawPanel = vi.fn();
		previewScene.drawNotes = vi.fn();
		previewScene.startPreview = vi.fn();

		previewScene.create();

		expect(previewScene.drawPanel).toHaveBeenCalled();
		expect(previewScene.drawNotes).toHaveBeenCalled();
		expect(previewScene.startPreview).toHaveBeenCalled();
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

		// Mock methods that are actually called in startPreview()
		previewScene.updateCameraZoom = vi.fn();
		previewScene.createPreviewTween = vi.fn();

		previewScene.startPreview();

		expect(previewScene.updateCameraZoom).toHaveBeenCalled();
		expect(previewScene.createPreviewTween).toHaveBeenCalled();
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
		const result = previewScene.drawNote(0, 0, 0.5, '11');

		// Verify the method executed successfully and returned true
		expect(result).toBe(true);
		expect(previewScene.getTotalMesaureOffest).toHaveBeenCalledWith(0);
		expect(previewScene.getCellHeight).toHaveBeenCalled();
	});
});
