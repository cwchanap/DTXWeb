import { describe, it, expect } from 'vitest';
import { toSimfileWithDtx } from './d1.types';
import type { SimfileRow } from './d1.types';

describe('toSimfileWithDtx', () => {
	const baseRow: SimfileRow = {
		id: 1,
		title: 'Test Song',
		artist: 'Test Artist',
		bpm: 120,
		user_id: 'user-123',
		is_published: 0,
		display_id: null,
		download_url: null,
		preview_url: null,
		video_preview_url: null,
		publish_date: '2024-01-01',
		created_at: '2024-01-01T00:00:00Z',
		updated_at: '2024-01-01T00:00:00Z'
	};

	it('converts is_published from 0 to false', () => {
		const result = toSimfileWithDtx({ ...baseRow, is_published: 0 }, []);
		expect(result.is_published).toBe(false);
	});

	it('converts is_published from 1 to true', () => {
		const result = toSimfileWithDtx({ ...baseRow, is_published: 1 }, []);
		expect(result.is_published).toBe(true);
	});

	it('includes provided dtx files', () => {
		const dtxFiles = [
			{ level: 50, label: 'BASIC' },
			{ level: 75, label: 'ADVANCED' }
		];
		const result = toSimfileWithDtx(baseRow, dtxFiles);
		expect(result.dtx_files).toEqual(dtxFiles);
	});

	it('returns empty dtx_files array when none provided', () => {
		const result = toSimfileWithDtx(baseRow, []);
		expect(result.dtx_files).toEqual([]);
	});

	it('preserves all other row properties', () => {
		const result = toSimfileWithDtx(baseRow, []);
		expect(result.id).toBe(1);
		expect(result.title).toBe('Test Song');
		expect(result.artist).toBe('Test Artist');
		expect(result.bpm).toBe(120);
		expect(result.user_id).toBe('user-123');
		expect(result.display_id).toBeNull();
		expect(result.download_url).toBeNull();
		expect(result.preview_url).toBeNull();
		expect(result.publish_date).toBe('2024-01-01');
	});

	it('preserves optional fields like video_preview_url', () => {
		const rowWithVideo: SimfileRow = {
			...baseRow,
			video_preview_url: 'https://example.com/video'
		};
		const result = toSimfileWithDtx(rowWithVideo, []);
		expect(result.video_preview_url).toBe('https://example.com/video');
	});
});
