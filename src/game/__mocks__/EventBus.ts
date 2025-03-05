import { vi } from 'vitest';

export default () => ({
	EventBus: {
		emit: vi.fn(),
		on: vi.fn()
	},
	EventType: {
		SCENE_READY: 'SCENE_READY',
		STOP_PREVIEW: 'STOP_PREVIEW'
	}
});
