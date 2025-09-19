import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

// Mock @dtx/common with functional store mocks
const createMockStore = <T>(initialValue: T) => {
	let value = initialValue;
	const subscribers = new Set<(value: T) => void>();

	return {
		subscribe: vi.fn((callback: (value: T) => void) => {
			subscribers.add(callback);
			callback(value);
			return () => subscribers.delete(callback);
		}),
		set: vi.fn((newValue: T) => {
			value = newValue;
			subscribers.forEach((callback) => callback(value));
		}),
		update: vi.fn((updater: (value: T) => T) => {
			value = updater(value);
			subscribers.forEach((callback) => callback(value));
		}),
		// Helper to get current value for testing
		_getValue: () => value,
		_getSubscribers: () => subscribers
	};
};

// Mock store with realistic initial values
const mockActiveScene = createMockStore<string>('MainMenu');
const mockCurrentDtxFile = createMockStore<any>(null);
const mockCurrentSimfile = createMockStore<any>(null);
const mockCurrentSoundChip = createMockStore<any>(null);
const mockPlayingAudio = createMockStore<boolean>(false);
const mockIsPreviewing = createMockStore<boolean>(false);
const mockPlaySpeed = createMockStore<number>(1.0);
const mockMeasureCount = createMockStore<number>(0);
const mockEditorNotes = createMockStore<any[]>([]);
const mockActiveNote = createMockStore<any>(null);
const mockCurrentSimfileID = createMockStore<string | null>(null);
const mockCurrentDifficulty = createMockStore<string>('Basic');
const mockKeyBindings = createMockStore<Record<string, string>>({});
const mockDisableBgmPreview = createMockStore<boolean>(false);

vi.mock('@dtx/common', () => ({
	store: {
		activeScene: mockActiveScene,
		currentDtxFile: mockCurrentDtxFile,
		currentSimfile: mockCurrentSimfile,
		currentSoundChip: mockCurrentSoundChip,
		playingAudio: mockPlayingAudio,
		isPreviewing: mockIsPreviewing,
		playSpeed: mockPlaySpeed,
		measureCount: mockMeasureCount,
		editorNotes: mockEditorNotes,
		activeNote: mockActiveNote,
		currentSimfileID: mockCurrentSimfileID,
		currentDifficulty: mockCurrentDifficulty,
		keyBindings: mockKeyBindings,
		disableBgmPreview: mockDisableBgmPreview
	}
}));

describe('Store Integration', () => {
	let store: any;

	beforeEach(async () => {
		vi.clearAllMocks();
		// Reset all store values
		mockActiveScene.set('MainMenu');
		mockCurrentDtxFile.set(null);
		mockCurrentSimfile.set(null);
		mockCurrentSoundChip.set(null);
		mockPlayingAudio.set(false);
		mockIsPreviewing.set(false);
		mockPlaySpeed.set(1.0);
		mockMeasureCount.set(0);
		mockEditorNotes.set([]);
		mockActiveNote.set(null);
		mockCurrentSimfileID.set(null);
		mockCurrentDifficulty.set('Basic');
		mockKeyBindings.set({});
		mockDisableBgmPreview.set(false);

		// Import store after mocks are set up
		const storeModule = await import('./store');
		store = storeModule.default;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('store structure and interface', () => {
		it('should export all required store properties', () => {
			expect(store).toHaveProperty('activeScene');
			expect(store).toHaveProperty('currentDtxFile');
			expect(store).toHaveProperty('currentSimfile');
			expect(store).toHaveProperty('currentSoundChip');
			expect(store).toHaveProperty('playingAudio');
			expect(store).toHaveProperty('isPreviewing');
			expect(store).toHaveProperty('playSpeed');
			expect(store).toHaveProperty('measureCount');
			expect(store).toHaveProperty('editorNotes');
			expect(store).toHaveProperty('activeNote');
			expect(store).toHaveProperty('currentSimfileID');
			expect(store).toHaveProperty('currentDifficulty');
			expect(store).toHaveProperty('keyBindings');
			expect(store).toHaveProperty('disableBgmPreview');
		});

		it('should maintain proper Svelte store interface', () => {
			const requiredMethods = ['subscribe', 'set', 'update'];
			const storeProperties = Object.keys(store);

			storeProperties.forEach((prop) => {
				const storeProperty = store[prop];
				requiredMethods.forEach((method) => {
					expect(storeProperty).toHaveProperty(method);
					expect(typeof storeProperty[method]).toBe('function');
				});
			});
		});
	});

	describe('activeScene store', () => {
		it('should handle scene transitions', () => {
			const scenes = ['MainMenu', 'Editor', 'Preview', 'BaseGame'];

			scenes.forEach((scene) => {
				store.activeScene.set(scene);
				expect(mockActiveScene._getValue()).toBe(scene);
				expect(mockActiveScene.set).toHaveBeenCalledWith(scene);
			});
		});

		it('should notify subscribers of scene changes', () => {
			const subscriber = vi.fn();
			const unsubscribe = store.activeScene.subscribe(subscriber);

			store.activeScene.set('Editor');
			store.activeScene.set('Preview');

			expect(subscriber).toHaveBeenCalledWith('MainMenu'); // Initial call
			expect(subscriber).toHaveBeenCalledWith('Editor');
			expect(subscriber).toHaveBeenCalledWith('Preview');
			expect(subscriber).toHaveBeenCalledTimes(3);

			unsubscribe();
		});
	});

	describe('currentDtxFile store', () => {
		it('should store DTX file data', () => {
			const mockDtxFile = {
				title: 'Test Song',
				artist: 'Test Artist',
				bpm: 120,
				lines: ['#TITLE: Test Song'],
				soundChips: []
			};

			store.currentDtxFile.set(mockDtxFile);

			expect(mockCurrentDtxFile._getValue()).toEqual(mockDtxFile);
			expect(mockCurrentDtxFile.set).toHaveBeenCalledWith(mockDtxFile);
		});

		it('should handle null DTX file', () => {
			store.currentDtxFile.set(null);

			expect(mockCurrentDtxFile._getValue()).toBeNull();
		});

		it('should update DTX file properties', () => {
			const initialDtxFile = { title: 'Original', bpm: 120 };
			store.currentDtxFile.set(initialDtxFile);

			store.currentDtxFile.update((file) => ({ ...file, title: 'Updated' }));

			expect(mockCurrentDtxFile.update).toHaveBeenCalled();
			expect(mockCurrentDtxFile._getValue().title).toBe('Updated');
		});
	});

	describe('playback control stores', () => {
		it('should manage playing audio state', () => {
			expect(mockPlayingAudio._getValue()).toBe(false);

			store.playingAudio.set(true);
			expect(mockPlayingAudio._getValue()).toBe(true);

			store.playingAudio.set(false);
			expect(mockPlayingAudio._getValue()).toBe(false);
		});

		it('should manage preview state', () => {
			expect(mockIsPreviewing._getValue()).toBe(false);

			store.isPreviewing.set(true);
			expect(mockIsPreviewing._getValue()).toBe(true);
		});

		it('should manage play speed', () => {
			const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

			speeds.forEach((speed) => {
				store.playSpeed.set(speed);
				expect(mockPlaySpeed._getValue()).toBe(speed);
			});
		});

		it('should update play speed incrementally', () => {
			store.playSpeed.set(1.0);

			store.playSpeed.update((speed) => speed * 1.25);

			expect(mockPlaySpeed._getValue()).toBe(1.25);
		});
	});

	describe('editor stores', () => {
		it('should manage editor notes', () => {
			const notes = [
				{ measure: 1, laneIndex: 0, cellOffset: 0, soundId: '01' },
				{ measure: 1, laneIndex: 1, cellOffset: 2, soundId: '02' }
			];

			store.editorNotes.set(notes);

			expect(mockEditorNotes._getValue()).toEqual(notes);
		});

		it('should add notes to editor', () => {
			const initialNotes = [{ measure: 1, laneIndex: 0, cellOffset: 0, soundId: '01' }];

			store.editorNotes.set(initialNotes);

			store.editorNotes.update((notes) => [
				...notes,
				{ measure: 1, laneIndex: 1, cellOffset: 2, soundId: '02' }
			]);

			const updatedNotes = mockEditorNotes._getValue();
			expect(updatedNotes).toHaveLength(2);
			expect(updatedNotes[1].soundId).toBe('02');
		});

		it('should manage active note selection', () => {
			const note = { measure: 1, laneIndex: 0, cellOffset: 0, soundId: '01' };

			store.activeNote.set(note);

			expect(mockActiveNote._getValue()).toEqual(note);
		});

		it('should manage measure count', () => {
			store.measureCount.set(64);

			expect(mockMeasureCount._getValue()).toBe(64);
		});
	});

	describe('simfile and workspace stores', () => {
		it('should manage current simfile', () => {
			const simfile = {
				id: 'simfile-123',
				title: 'Test Song',
				dtxFiles: [],
				assetFiles: []
			};

			store.currentSimfile.set(simfile);

			expect(mockCurrentSimfile._getValue()).toEqual(simfile);
		});

		it('should manage current simfile ID', () => {
			const simfileId = 'simfile-456';

			store.currentSimfileID.set(simfileId);

			expect(mockCurrentSimfileID._getValue()).toBe(simfileId);
		});

		it('should handle null simfile ID', () => {
			store.currentSimfileID.set(null);

			expect(mockCurrentSimfileID._getValue()).toBeNull();
		});

		it('should manage difficulty selection', () => {
			const difficulties = ['Basic', 'Advanced', 'Extreme', 'Master'];

			difficulties.forEach((difficulty) => {
				store.currentDifficulty.set(difficulty);
				expect(mockCurrentDifficulty._getValue()).toBe(difficulty);
			});
		});
	});

	describe('audio and sound stores', () => {
		it('should manage current sound chip', () => {
			const soundChip = {
				id: '01',
				fileName: 'kick.wav',
				volume: 100
			};

			store.currentSoundChip.set(soundChip);

			expect(mockCurrentSoundChip._getValue()).toEqual(soundChip);
		});

		it('should manage BGM preview setting', () => {
			store.disableBgmPreview.set(true);

			expect(mockDisableBgmPreview._getValue()).toBe(true);
		});
	});

	describe('key bindings store', () => {
		it('should manage key bindings', () => {
			const keyBindings = {
				lane_0: 'KeyA',
				lane_1: 'KeyS',
				lane_2: 'KeyD',
				play_pause: 'Space',
				stop: 'Escape'
			};

			store.keyBindings.set(keyBindings);

			expect(mockKeyBindings._getValue()).toEqual(keyBindings);
		});

		it('should update individual key bindings', () => {
			const initialBindings = { lane_0: 'KeyA' };
			store.keyBindings.set(initialBindings);

			store.keyBindings.update((bindings) => ({
				...bindings,
				lane_1: 'KeyS'
			}));

			const updatedBindings = mockKeyBindings._getValue();
			expect(updatedBindings).toEqual({
				lane_0: 'KeyA',
				lane_1: 'KeyS'
			});
		});
	});

	describe('store interactions and workflow', () => {
		it('should handle complete editor workflow', () => {
			const mockDtxFile = { title: 'Test Song', bpm: 120 };
			const mockSimfile = { id: 'sim-1', title: 'Test Song' };
			const mockNotes = [{ measure: 1, laneIndex: 0, cellOffset: 0 }];

			// Simulate opening editor
			store.activeScene.set('Editor');
			store.currentDtxFile.set(mockDtxFile);
			store.currentSimfile.set(mockSimfile);
			store.editorNotes.set(mockNotes);
			store.measureCount.set(32);

			// Verify all stores updated
			expect(mockActiveScene._getValue()).toBe('Editor');
			expect(mockCurrentDtxFile._getValue()).toEqual(mockDtxFile);
			expect(mockCurrentSimfile._getValue()).toEqual(mockSimfile);
			expect(mockEditorNotes._getValue()).toEqual(mockNotes);
			expect(mockMeasureCount._getValue()).toBe(32);
		});

		it('should handle preview workflow', () => {
			const mockDtxFile = { title: 'Test Song', bpm: 120 };

			// Simulate starting preview
			store.activeScene.set('Preview');
			store.currentDtxFile.set(mockDtxFile);
			store.isPreviewing.set(true);
			store.playingAudio.set(true);
			store.playSpeed.set(1.0);

			// Verify preview state
			expect(mockActiveScene._getValue()).toBe('Preview');
			expect(mockIsPreviewing._getValue()).toBe(true);
			expect(mockPlayingAudio._getValue()).toBe(true);
			expect(mockPlaySpeed._getValue()).toBe(1.0);
		});

		it('should handle cleanup when switching contexts', () => {
			// Set up some state
			store.currentDtxFile.set({ title: 'Test' });
			store.editorNotes.set([{ measure: 1 }]);
			store.activeNote.set({ measure: 1 });
			store.isPreviewing.set(true);

			// Simulate cleanup (returning to main menu)
			store.activeScene.set('MainMenu');
			store.currentDtxFile.set(null);
			store.editorNotes.set([]);
			store.activeNote.set(null);
			store.isPreviewing.set(false);
			store.playingAudio.set(false);

			// Verify cleanup
			expect(mockActiveScene._getValue()).toBe('MainMenu');
			expect(mockCurrentDtxFile._getValue()).toBeNull();
			expect(mockEditorNotes._getValue()).toEqual([]);
			expect(mockActiveNote._getValue()).toBeNull();
			expect(mockIsPreviewing._getValue()).toBe(false);
			expect(mockPlayingAudio._getValue()).toBe(false);
		});
	});

	describe('subscription management', () => {
		it('should properly handle multiple subscribers', () => {
			const subscriber1 = vi.fn();
			const subscriber2 = vi.fn();

			const unsubscribe1 = store.activeScene.subscribe(subscriber1);
			const unsubscribe2 = store.activeScene.subscribe(subscriber2);

			store.activeScene.set('Editor');

			expect(subscriber1).toHaveBeenCalledWith('MainMenu'); // Initial
			expect(subscriber1).toHaveBeenCalledWith('Editor'); // Update
			expect(subscriber2).toHaveBeenCalledWith('MainMenu'); // Initial
			expect(subscriber2).toHaveBeenCalledWith('Editor'); // Update

			unsubscribe1();
			unsubscribe2();
		});

		it('should handle unsubscription properly', () => {
			const subscriber = vi.fn();
			const unsubscribe = store.activeScene.subscribe(subscriber);

			store.activeScene.set('Editor');
			expect(subscriber).toHaveBeenCalledTimes(2); // Initial + update

			unsubscribe();

			store.activeScene.set('Preview');
			expect(subscriber).toHaveBeenCalledTimes(2); // Should not be called after unsubscribe
		});
	});

	describe('type safety and validation', () => {
		it('should handle different data types appropriately', () => {
			// String
			store.activeScene.set('Editor');
			expect(typeof mockActiveScene._getValue()).toBe('string');

			// Boolean
			store.playingAudio.set(true);
			expect(typeof mockPlayingAudio._getValue()).toBe('boolean');

			// Number
			store.playSpeed.set(1.5);
			expect(typeof mockPlaySpeed._getValue()).toBe('number');

			// Array
			store.editorNotes.set([]);
			expect(Array.isArray(mockEditorNotes._getValue())).toBe(true);

			// Object
			store.keyBindings.set({ test: 'value' });
			expect(typeof mockKeyBindings._getValue()).toBe('object');

			// Null
			store.currentDtxFile.set(null);
			expect(mockCurrentDtxFile._getValue()).toBeNull();
		});
	});
});
