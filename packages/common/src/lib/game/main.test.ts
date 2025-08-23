import { describe, it, expect } from 'vitest';
import { config } from './main';

describe('main game configuration', () => {
	describe('scene management', () => {
		it('should include all required scenes in correct order', () => {
			const sceneClasses = config.scene as Phaser.Types.Scenes.SceneType[];
			expect(sceneClasses.length).toBe(4);
			expect((sceneClasses[0] as any).name).toBe('Preloader'); // First scene must be Preloader
		});

		it('should have game configuration with expected dimensions and styling', () => {
			expect(config.width).toBe(960);
			expect(config.height).toBe(1080);
			expect(config.parent).toBe('game-container');
			expect(config.backgroundColor).toBe('#444B4B');
		});
	});
});
