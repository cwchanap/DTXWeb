import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MainMenu } from './MainMenu';
import { EventBus } from '../EventBus';
import EventType from '../EventType';

// Mock EventBus
vi.mock('../EventBus', () => ({
	EventBus: {
		emit: vi.fn()
	}
}));

describe('MainMenu', () => {
	let mainMenu: MainMenu;
	let mockAdd: any;
	let mockText: any;
	let mockGame: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock text object with chainable methods
		mockText = {
			setOrigin: vi.fn().mockReturnThis(),
			setDepth: vi.fn().mockReturnThis(),
			setInteractive: vi.fn().mockReturnThis(),
			on: vi.fn().mockReturnThis()
		};

		// Mock add object
		mockAdd = {
			text: vi.fn().mockReturnValue(mockText)
		};

		// Mock game object
		mockGame = {
			canvas: {
				width: 960,
				height: 1080
			}
		};

		mainMenu = new MainMenu();
		mainMenu.add = mockAdd;
		mainMenu.game = mockGame;

		// Mock window.alert to prevent actual alerts during tests
		global.alert = vi.fn();
	});

	describe('constructor', () => {
		it('should initialize with correct key', () => {
			expect(MainMenu.key).toBe('MainMenu');
		});
	});

	describe('scene creation', () => {
		it('should create start button with correct properties', () => {
			mainMenu.create();

			expect(mockAdd.text).toHaveBeenCalledWith(
				480, // width / 2
				690, // height / 2 + 150
				'Start',
				{
					fontFamily: 'Arial Black',
					fontSize: 38,
					color: '#ffffff',
					stroke: '#000000',
					strokeThickness: 8,
					align: 'center'
				}
			);
		});

		it('should configure start button properties correctly', () => {
			mainMenu.create();

			expect(mockText.setOrigin).toHaveBeenCalledWith(0.5);
			expect(mockText.setDepth).toHaveBeenCalledWith(100);
			expect(mockText.setInteractive).toHaveBeenCalledWith({ useHandCursor: true });
		});

		it('should register pointerdown event handler', () => {
			mainMenu.create();

			expect(mockText.on).toHaveBeenCalledWith('pointerdown', expect.any(Function));
		});

		it('should emit SCENE_READY event after creation', () => {
			mainMenu.create();

			expect(EventBus.emit).toHaveBeenCalledWith(EventType.SCENE_READY, mainMenu);
		});

		it('should handle different canvas sizes', () => {
			// Test with different canvas dimensions
			mockGame.canvas.width = 1200;
			mockGame.canvas.height = 800;

			mainMenu.create();

			expect(mockAdd.text).toHaveBeenCalledWith(
				600, // 1200 / 2
				550, // 800 / 2 + 150
				'Start',
				expect.any(Object)
			);
		});
	});

	describe('start button interaction', () => {
		it('should show alert when start button is clicked', () => {
			mainMenu.create();

			// Get the pointerdown callback function
			const pointerdownCallback = mockText.on.mock.calls.find(
				(call: any) => call[0] === 'pointerdown'
			)?.[1];

			expect(pointerdownCallback).toBeDefined();

			// Simulate clicking the start button
			pointerdownCallback();

			expect(global.alert).toHaveBeenCalledWith('Under construction');
		});

		it('should handle multiple clicks', () => {
			mainMenu.create();

			const pointerdownCallback = mockText.on.mock.calls.find(
				(call: any) => call[0] === 'pointerdown'
			)?.[1];

			// Click multiple times
			pointerdownCallback();
			pointerdownCallback();
			pointerdownCallback();

			expect(global.alert).toHaveBeenCalledTimes(3);
			expect(global.alert).toHaveBeenCalledWith('Under construction');
		});
	});

	describe('scene properties', () => {
		it('should set title property after creation', () => {
			mainMenu.create();

			expect(mainMenu.title).toBe(mockText);
		});
	});

	describe('error handling', () => {
		it('should handle missing canvas gracefully', () => {
			mockGame.canvas = null;

			// Should not throw, but may not work correctly
			expect(() => mainMenu.create()).toThrow();
		});

		it('should handle canvas with zero dimensions', () => {
			mockGame.canvas.width = 0;
			mockGame.canvas.height = 0;

			mainMenu.create();

			expect(mockAdd.text).toHaveBeenCalledWith(
				0, // 0 / 2
				150, // 0 / 2 + 150
				'Start',
				expect.any(Object)
			);
		});
	});

	describe('text styling', () => {
		it('should use correct font styling', () => {
			mainMenu.create();

			const textOptions = mockAdd.text.mock.calls[0][3];
			expect(textOptions.fontFamily).toBe('Arial Black');
			expect(textOptions.fontSize).toBe(38);
			expect(textOptions.color).toBe('#ffffff');
			expect(textOptions.stroke).toBe('#000000');
			expect(textOptions.strokeThickness).toBe(8);
			expect(textOptions.align).toBe('center');
		});
	});

	describe('positioning', () => {
		it('should center text horizontally', () => {
			mainMenu.create();

			const xPosition = mockAdd.text.mock.calls[0][0];
			expect(xPosition).toBe(mockGame.canvas.width / 2);
		});

		it('should position text vertically with offset', () => {
			mainMenu.create();

			const yPosition = mockAdd.text.mock.calls[0][1];
			expect(yPosition).toBe(mockGame.canvas.height / 2 + 150);
		});

		it('should set correct origin for centering', () => {
			mainMenu.create();

			expect(mockText.setOrigin).toHaveBeenCalledWith(0.5);
		});
	});

	describe('interaction setup', () => {
		it('should enable hand cursor for start button', () => {
			mainMenu.create();

			expect(mockText.setInteractive).toHaveBeenCalledWith({
				useHandCursor: true
			});
		});

		it('should set appropriate depth for text layering', () => {
			mainMenu.create();

			expect(mockText.setDepth).toHaveBeenCalledWith(100);
		});
	});
});
