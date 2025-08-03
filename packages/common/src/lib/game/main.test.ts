import { describe, it, expect } from 'vitest';
import { config } from './main';

describe('main game configuration', () => {
	describe('scene management', () => {
		it('should include all required scenes in correct order', () => {
			const sceneClasses = config.scene;
			expect(Array.isArray(sceneClasses)).toBe(true);
			expect(sceneClasses.length).toBe(4);
			expect(sceneClasses[0].name).toBe('Preloader'); // First scene
		});

		it('should have basic game configuration properties', () => {
			expect(config.type).toBeDefined();
			expect(config.width).toBe(960);
			expect(config.height).toBe(1080);
			expect(config.parent).toBe('game-container');
			expect(config.backgroundColor).toBe('#444B4B');
		});
	});
});
