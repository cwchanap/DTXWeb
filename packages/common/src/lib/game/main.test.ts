import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// ── main.svelte component tests ──────────────────────────────────────────────

vi.mock('@testing-library/svelte', async () => await vi.importActual('@testing-library/svelte'));

const { mockEventBus } = vi.hoisted(() => {
	const mockEventBus = {
		on: vi.fn(),
		off: vi.fn(),
		emit: vi.fn()
	};
	return { mockEventBus };
});

vi.mock('./EventBus', () => ({ EventBus: mockEventBus }));

import { render } from '@testing-library/svelte';
import MainGame from './main.svelte';

describe('main.svelte component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the game container div', () => {
		render(MainGame, { props: { currentActiveScene: vi.fn() } });
		expect(document.getElementById('game-container')).toBeInTheDocument();
	});

	it('initialises Phaser.Game on mount', () => {
		render(MainGame, { props: { currentActiveScene: vi.fn() } });
		expect(Phaser.Game).toHaveBeenCalled();
	});

	it('registers SCENE_READY listener on EventBus on mount', () => {
		render(MainGame, { props: { currentActiveScene: vi.fn() } });
		expect(mockEventBus.on).toHaveBeenCalled();
	});

	it('calls currentActiveScene when SCENE_READY fires', () => {
		const currentActiveScene = vi.fn();
		render(MainGame, { props: { currentActiveScene } });

		// Grab the SCENE_READY callback registered on EventBus.on
		const sceneReadyCall = mockEventBus.on.mock.calls.find(
			([event]: [string]) => event === 'current-scene-ready'
		);
		const [, sceneReadyCallback] = sceneReadyCall!;
		const mockScene = { key: 'Editor' };
		sceneReadyCallback(mockScene);

		expect(currentActiveScene).toHaveBeenCalledWith(mockScene);
	});

	it('sets phaserRef.game after mount', () => {
		const phaserRef = { game: null, scene: null };
		render(MainGame, { props: { phaserRef, currentActiveScene: vi.fn() } });
		expect(phaserRef.game).not.toBeNull();
	});
});
