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

		it('should have canvas configuration for WebGL rendering', () => {
			expect(config.canvas).toBeDefined();
			expect(config.render?.webgl?.pipeline).toBeDefined();
		});
	});
});
