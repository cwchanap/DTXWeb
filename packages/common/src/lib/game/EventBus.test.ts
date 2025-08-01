import { describe, it, expect } from 'vitest';
import { EventBus } from './EventBus';
import EventType from './EventType';

describe('EventBus', () => {
	describe('event types integration', () => {
		it('should have unique event type values', () => {
			const eventTypes = [
				EventType.SCENE_READY,
				EventType.MEASURE_UPDATE,
				EventType.MEASURE_GOTO,
				EventType.NOTE_IMPORT,
				EventType.START_PREVIEW,
				EventType.RESUME_PREVIEW,
				EventType.STOP_PREVIEW
			];

			const uniqueTypes = new Set(eventTypes);
			expect(uniqueTypes.size).toBe(eventTypes.length);
		});
	});
});
