import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createGoogleDriveStore } from './googleDriveStore';

describe('googleDriveStore', () => {
	it('ignores unrelated, stale, and terminal progress without retaining sensitive native state', () => {
		const store = createGoogleDriveStore();
		store.setConnection({ connected: true, folder: { id: 'folder-id', name: 'Exports' } });
		store.beginOperation('op-current', 'simfile-current');
		store.applyProgress({
			operationId: 'op-other',
			simfileId: 'simfile-other',
			stage: 'uploading',
			percentage: 50
		});
		store.applyProgress({
			operationId: 'op-current',
			simfileId: 'simfile-current',
			stage: 'upload-complete'
		});
		store.applyProgress({
			operationId: 'op-current',
			simfileId: 'simfile-current',
			stage: 'uploading',
			percentage: 99
		});

		expect(get(store)).toEqual({
			connection: { connected: true, folder: { id: 'folder-id', name: 'Exports' } },
			operation: {
				operationId: 'op-current',
				simfileId: 'simfile-current',
				stage: 'upload-complete'
			},
			error: null
		});
	});

	it('resets immediately when authentication changes', () => {
		const store = createGoogleDriveStore();
		store.setConnection({ connected: true, folder: { id: 'folder-id', name: 'Exports' } });
		store.beginOperation('op-current', 'simfile-current');
		store.reset();

		expect(get(store)).toEqual({ connection: null, operation: null, error: null });
	});

	it('ignores an upload error from an operation replaced by a newer operation', () => {
		const store = createGoogleDriveStore();
		store.beginOperation('op-old', 'simfile-old');
		store.beginOperation('op-current', 'simfile-current');
		store.setUploadError('op-old', 'simfile-old', 'UNKNOWN');

		expect(get(store).error).toBeNull();
	});
});
