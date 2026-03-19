// Mock svelte/store with controllable get function
vi.mock('svelte/store', () => ({
	get: vi.fn(),
	writable: vi.fn(() => ({
		subscribe: vi.fn(),
		set: vi.fn(),
		update: vi.fn()
	}))
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Preloader } from './Preload';
import { MainMenu } from './scenes/MainMenu';
import { get } from 'svelte/store';

describe('Preloader', () => {
	let preloader: Preloader;
	let mockLoad: any;
	let mockScene: any;
	let mockAdd: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock load object with event handling
		mockLoad = {
			on: vi.fn().mockImplementation((event, callback) => {
				if (event === 'complete') {
					// Store the callback for manual triggering in tests
					mockLoad._completeCallback = callback;
				}
				return mockLoad;
			}),
			_completeCallback: null,
			_triggerComplete: () => {
				if (mockLoad._completeCallback) {
					mockLoad._completeCallback();
				}
			}
		};

		// Mock scene management
		mockScene = {
			start: vi.fn(),
			key: 'Preloader'
		};

		// Mock add object for text creation
		mockAdd = {
			text: vi.fn().mockReturnValue({
				setOrigin: vi.fn().mockReturnThis(),
				setText: vi.fn().mockReturnThis()
			})
		};

		preloader = new Preloader();
		preloader.load = mockLoad;
		preloader.scene = mockScene;
		preloader.add = mockAdd;
	});

	describe('scene transition logic', () => {
		it('should start MainMenu scene when no active scene is set', () => {
			vi.mocked(get).mockReturnValue(null);

			preloader.init();
			mockLoad._triggerComplete();

			expect(mockScene.start).toHaveBeenCalledWith(MainMenu.key);
		});

		it('should start MainMenu scene when active scene is undefined', () => {
			vi.mocked(get).mockReturnValue(undefined);

			preloader.init();
			mockLoad._triggerComplete();

			expect(mockScene.start).toHaveBeenCalledWith(MainMenu.key);
		});

		it('should start specified active scene when set', () => {
			const customScene = 'CustomScene';
			vi.mocked(get).mockReturnValue(customScene);

			preloader.init();
			mockLoad._triggerComplete();

			expect(mockScene.start).toHaveBeenCalledWith(customScene);
		});

		it('should work with different scene transitions', () => {
			const scenarios = [
				{ activeScene: null, expectedStart: MainMenu.key },
				{ activeScene: undefined, expectedStart: MainMenu.key },
				{ activeScene: 'Editor', expectedStart: 'Editor' },
				{ activeScene: 'Preview', expectedStart: 'Preview' },
				{ activeScene: 'CustomScene', expectedStart: 'CustomScene' }
			];

			scenarios.forEach(({ activeScene, expectedStart }) => {
				vi.clearAllMocks();
				vi.mocked(get).mockReturnValue(activeScene);

				preloader.init();
				mockLoad._triggerComplete();

				expect(mockScene.start).toHaveBeenCalledWith(expectedStart);
			});
		});
	});

	describe('preload', () => {
		it('should execute without errors', () => {
			expect(() => preloader.preload()).not.toThrow();
		});
	});

	describe('create', () => {
		it('should add text to the scene', () => {
			preloader.create();
			expect(mockAdd.text).toHaveBeenCalledWith(20, 20, 'Loading game...');
		});
	});

	describe('error handling', () => {
		it('should handle store access errors', () => {
			vi.mocked(get).mockImplementation(() => {
				throw new Error('Store access error');
			});

			preloader.init();

			expect(() => mockLoad._triggerComplete()).toThrow('Store access error');
		});

		it('should handle scene.start errors', () => {
			mockScene.start.mockImplementation(() => {
				throw new Error('Scene start error');
			});
			vi.mocked(get).mockReturnValue('ValidScene');

			preloader.init();

			expect(() => mockLoad._triggerComplete()).toThrow('Scene start error');
		});
	});
});
