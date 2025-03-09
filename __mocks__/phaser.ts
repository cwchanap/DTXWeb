import { vi } from 'vitest';

const Scene = class MockScene {
	sound = {
		add: vi.fn().mockReturnValue({
			play: vi.fn(),
			stop: vi.fn(),
			on: vi.fn(),
			isPlaying: false
		})
	};
	input = { keyboard: { createCursorKeys: vi.fn() } };
};

export { Scene };
export default { Scene };
