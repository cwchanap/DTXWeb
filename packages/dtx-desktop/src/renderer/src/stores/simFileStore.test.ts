import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { simFileStore } from './simFileStore';
import type { SimfileWithDtx } from '@dtx/common';

const makeSimFile = (id: number, title: string = `Song ${id}`): SimfileWithDtx => ({
	id,
	title,
	artist: 'Artist',
	bpm: 120,
	preview_url: null,
	download_url: null,
	is_published: false,
	display_id: null,
	publish_date: '2024-01-01',
	video_preview_url: null,
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
	user_id: 'test-user',
	dtx_files: []
});

describe('simFileStore', () => {
	beforeEach(() => {
		simFileStore.reset();
	});

	it('should initialize with default state', () => {
		const state = get(simFileStore);
		expect(state.userSimFiles).toEqual([]);
		expect(state.isLoading).toBe(false);
		expect(state.error).toBeNull();
		expect(state.lastUpdated).toBeNull();
		expect(state.fromCache).toBe(false);
	});

	describe('setLoading', () => {
		it('should set isLoading to true and clear error', () => {
			simFileStore.setError('previous error');
			simFileStore.setLoading(true);

			const state = get(simFileStore);
			expect(state.isLoading).toBe(true);
			expect(state.error).toBeNull();
		});

		it('should set isLoading to false', () => {
			simFileStore.setLoading(true);
			simFileStore.setLoading(false);

			expect(get(simFileStore).isLoading).toBe(false);
		});
	});

	describe('setError', () => {
		it('should set error and clear loading state', () => {
			simFileStore.setLoading(true);
			simFileStore.setError('Something went wrong');

			const state = get(simFileStore);
			expect(state.error).toBe('Something went wrong');
			expect(state.isLoading).toBe(false);
		});
	});

	describe('clearError', () => {
		it('should clear the error', () => {
			simFileStore.setError('some error');
			simFileStore.clearError();

			expect(get(simFileStore).error).toBeNull();
		});

		it('should not affect other state', () => {
			simFileStore.setUserSimFiles([makeSimFile(1)]);
			simFileStore.setError('error');
			simFileStore.clearError();

			const state = get(simFileStore);
			expect(state.userSimFiles).toHaveLength(1);
		});
	});

	describe('setUserSimFiles', () => {
		it('should set user simFiles', () => {
			const files = [makeSimFile(1), makeSimFile(2)];
			simFileStore.setUserSimFiles(files);

			const state = get(simFileStore);
			expect(state.userSimFiles).toEqual(files);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBeNull();
		});

		it('should update lastUpdated', () => {
			const before = new Date();
			simFileStore.setUserSimFiles([makeSimFile(1)]);
			const after = new Date();

			const state = get(simFileStore);
			expect(state.lastUpdated).not.toBeNull();
			expect(state.lastUpdated!.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(state.lastUpdated!.getTime()).toBeLessThanOrEqual(after.getTime());
		});

		it('should set fromCache flag', () => {
			simFileStore.setUserSimFiles([makeSimFile(1)], true);
			expect(get(simFileStore).fromCache).toBe(true);

			simFileStore.setUserSimFiles([makeSimFile(1)], false);
			expect(get(simFileStore).fromCache).toBe(false);
		});

		it('should default fromCache to false', () => {
			simFileStore.setUserSimFiles([makeSimFile(1)]);
			expect(get(simFileStore).fromCache).toBe(false);
		});
	});

	describe('addUserSimFile', () => {
		it('should prepend a simFile to the list', () => {
			simFileStore.setUserSimFiles([makeSimFile(2), makeSimFile(3)]);
			simFileStore.addUserSimFile(makeSimFile(1));

			const state = get(simFileStore);
			expect(state.userSimFiles).toHaveLength(3);
			expect(state.userSimFiles[0].id).toBe(1);
		});

		it('should update lastUpdated', () => {
			const before = new Date();
			simFileStore.addUserSimFile(makeSimFile(1));
			const after = new Date();

			const state = get(simFileStore);
			expect(state.lastUpdated!.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(state.lastUpdated!.getTime()).toBeLessThanOrEqual(after.getTime());
		});
	});

	describe('updateUserSimFile', () => {
		it('should update an existing simFile by id', () => {
			simFileStore.setUserSimFiles([makeSimFile(1, 'Original Title'), makeSimFile(2)]);

			const updated = makeSimFile(1, 'Updated Title');
			simFileStore.updateUserSimFile(updated);

			const state = get(simFileStore);
			expect(state.userSimFiles[0].title).toBe('Updated Title');
		});

		it('should not affect other simFiles', () => {
			simFileStore.setUserSimFiles([makeSimFile(1), makeSimFile(2, 'Keep Me')]);

			simFileStore.updateUserSimFile(makeSimFile(1, 'Updated'));

			const state = get(simFileStore);
			expect(state.userSimFiles[1].title).toBe('Keep Me');
		});

		it('should update lastUpdated', () => {
			simFileStore.setUserSimFiles([makeSimFile(1)]);
			const before = new Date();
			simFileStore.updateUserSimFile(makeSimFile(1, 'Updated'));
			const after = new Date();

			const state = get(simFileStore);
			expect(state.lastUpdated!.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(state.lastUpdated!.getTime()).toBeLessThanOrEqual(after.getTime());
		});
	});

	describe('removeUserSimFile', () => {
		it('should remove a simFile by id', () => {
			simFileStore.setUserSimFiles([makeSimFile(1), makeSimFile(2)]);
			simFileStore.removeUserSimFile(1);

			const state = get(simFileStore);
			expect(state.userSimFiles).toHaveLength(1);
			expect(state.userSimFiles[0].id).toBe(2);
		});

		it('should update lastUpdated', () => {
			simFileStore.setUserSimFiles([makeSimFile(1)]);
			const before = new Date();
			simFileStore.removeUserSimFile(1);
			const after = new Date();

			const state = get(simFileStore);
			expect(state.lastUpdated!.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(state.lastUpdated!.getTime()).toBeLessThanOrEqual(after.getTime());
		});

		it('should not modify list when id does not exist', () => {
			simFileStore.setUserSimFiles([makeSimFile(1), makeSimFile(2)]);
			simFileStore.removeUserSimFile(999);

			expect(get(simFileStore).userSimFiles).toHaveLength(2);
		});
	});

	describe('filterUserSimFiles', () => {
		it('should return filtered simFiles without modifying store', () => {
			simFileStore.setUserSimFiles([makeSimFile(1), makeSimFile(2), makeSimFile(3)]);

			const filtered = simFileStore.filterUserSimFiles((sf) => sf.id > 1);

			expect(filtered).toHaveLength(2);
			expect(filtered.map((sf) => sf.id)).toEqual([2, 3]);
			// Store should be unchanged
			expect(get(simFileStore).userSimFiles).toHaveLength(3);
		});

		it('should return empty array when no matches', () => {
			simFileStore.setUserSimFiles([makeSimFile(1)]);

			const filtered = simFileStore.filterUserSimFiles(() => false);
			expect(filtered).toEqual([]);
		});
	});

	describe('getSimFileById', () => {
		it('should return the simFile with matching id', () => {
			simFileStore.setUserSimFiles([makeSimFile(1), makeSimFile(2)]);

			const result = simFileStore.getSimFileById(2);
			expect(result?.id).toBe(2);
		});

		it('should return undefined for non-existent id', () => {
			simFileStore.setUserSimFiles([makeSimFile(1)]);

			const result = simFileStore.getSimFileById(999);
			expect(result).toBeUndefined();
		});
	});

	describe('getCurrentState', () => {
		it('should return the current state without modifying it', () => {
			const files = [makeSimFile(1)];
			simFileStore.setUserSimFiles(files);

			const state = simFileStore.getCurrentState();
			expect(state.userSimFiles).toHaveLength(1);
			expect(state.isLoading).toBe(false);
			// Store should still be unchanged
			expect(get(simFileStore).userSimFiles).toHaveLength(1);
		});
	});

	describe('reset', () => {
		it('should return to initial state', () => {
			simFileStore.setUserSimFiles([makeSimFile(1), makeSimFile(2)]);
			simFileStore.setLoading(true);
			simFileStore.setError('error');
			simFileStore.reset();

			const state = get(simFileStore);
			expect(state.userSimFiles).toEqual([]);
			expect(state.isLoading).toBe(false);
			expect(state.error).toBeNull();
			expect(state.lastUpdated).toBeNull();
			expect(state.fromCache).toBe(false);
		});
	});
});
