import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
	createGoogleDriveStore,
	getActiveGoogleDriveOperationForSimfile
} from './googleDriveStore';

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
			publicDownloadVerified: false,
			revocationUnconfirmed: false,
			operations: {
				'op-current': {
					operationId: 'op-current',
					simfileId: 'simfile-current',
					stage: 'upload-complete'
				}
			},
			error: null
		});
	});

	it('resets immediately when authentication changes', () => {
		const store = createGoogleDriveStore();
		store.setConnection({ connected: true, folder: { id: 'folder-id', name: 'Exports' } });
		store.beginOperation('op-current', 'simfile-current');
		store.reset();

		expect(get(store)).toEqual({
			connection: null,
			publicDownloadVerified: false,
			revocationUnconfirmed: false,
			operations: {},
			error: null
		});
	});

	it('keeps two uploads independently addressable and rejects out-of-order stages', () => {
		const store = createGoogleDriveStore();
		store.beginOperation('op-a', 'simfile-a');
		store.beginOperation('op-b', 'simfile-b');
		store.applyProgress({
			operationId: 'op-a',
			simfileId: 'simfile-a',
			stage: 'uploading',
			percentage: 50
		});
		store.applyProgress({
			operationId: 'op-b',
			simfileId: 'simfile-b',
			stage: 'preparing-zip'
		});
		store.applyProgress({
			operationId: 'op-a',
			simfileId: 'simfile-a',
			stage: 'preparing-zip'
		});

		expect(get(store).operations).toEqual({
			'op-a': expect.objectContaining({ stage: 'uploading', percentage: 50 }),
			'op-b': expect.objectContaining({ stage: 'preparing-zip' })
		});
	});

	it('selects only a nonterminal operation for the requested simfile', () => {
		const store = createGoogleDriveStore();
		store.beginOperation('op-a', 'simfile-a');
		store.beginOperation('op-b', 'simfile-b');

		expect(getActiveGoogleDriveOperationForSimfile(get(store), 'simfile-a')?.operationId).toBe(
			'op-a'
		);
		expect(getActiveGoogleDriveOperationForSimfile(get(store), 'simfile-b')?.operationId).toBe(
			'op-b'
		);

		store.applyProgress({
			operationId: 'op-a',
			simfileId: 'simfile-a',
			stage: 'upload-complete'
		});

		expect(getActiveGoogleDriveOperationForSimfile(get(store), 'simfile-a')).toBeUndefined();
		expect(getActiveGoogleDriveOperationForSimfile(get(store), 'simfile-b')?.operationId).toBe(
			'op-b'
		);
	});

	it('drops an async connection result captured before an auth reset', () => {
		const store = createGoogleDriveStore();
		const generation = store.captureGeneration();
		store.reset();
		store.setConnectionIfCurrent(generation, {
			connected: true,
			folder: { id: 'folder-id', name: 'Exports' }
		});

		expect(get(store).connection).toBeNull();
	});

	it('keeps public-link verification unknown for refreshes and marks only successful validation actions', () => {
		const store = createGoogleDriveStore();
		const generation = store.captureGeneration();
		const connection = { connected: true, folder: { id: 'folder-id', name: 'Exports' } };

		store.setConnectionIfCurrent(generation, connection, 'refresh');
		expect(get(store).publicDownloadVerified).toBe(false);

		store.setConnectionIfCurrent(generation, connection, 'recheck-sharing');
		expect(get(store).publicDownloadVerified).toBe(true);
	});

	it('preserves revocation uncertainty through refresh and clears it only after reconnection', () => {
		const store = createGoogleDriveStore();
		const generation = store.captureGeneration();
		store.setConnectionIfCurrent(generation, { connected: true }, 'recheck-sharing');
		expect(get(store).publicDownloadVerified).toBe(true);
		store.setDisconnectIfCurrent(generation, {
			connection: { connected: false },
			revocationUnconfirmed: true
		});
		expect(get(store).publicDownloadVerified).toBe(false);

		store.setConnectionIfCurrent(generation, { connected: false }, 'refresh');
		expect(get(store).revocationUnconfirmed).toBe(true);

		store.setConnectionIfCurrent(generation, { connected: true }, 'connect');
		expect(get(store).revocationUnconfirmed).toBe(false);
	});

	it('beginConnectionRequest gives each action its own generation so a stale refresh cannot overwrite a newer connect', () => {
		// Regression: when refresh and connect shared a single generation counter,
		// a slow refresh that resolved after a faster connect would overwrite the
		// connect's result because both actions compared equal to the current
		// generation. beginConnectionRequest bumps the generation up-front so
		// only the most recently begun action's result is applied.
		const store = createGoogleDriveStore();
		const refreshGeneration = store.beginConnectionRequest();
		const connectGeneration = store.beginConnectionRequest();

		expect(connectGeneration).toBeGreaterThan(refreshGeneration);

		// The connect resolves first.
		store.setConnectionIfCurrent(
			connectGeneration,
			{ connected: true, folder: { id: 'folder-1', name: 'Uploads' } },
			'connect'
		);
		expect(get(store).connection).toEqual({
			connected: true,
			folder: { id: 'folder-1', name: 'Uploads' }
		});

		// The stale refresh resolves later — it must NOT overwrite the connect.
		store.setConnectionIfCurrent(refreshGeneration, { connected: false }, 'refresh');
		expect(get(store).connection).toEqual({
			connected: true,
			folder: { id: 'folder-1', name: 'Uploads' }
		});
	});

	it('beginConnectionRequest still allows reset to invalidate in-flight actions', () => {
		const store = createGoogleDriveStore();
		const generation = store.beginConnectionRequest();
		store.reset();
		store.setConnectionIfCurrent(generation, {
			connected: true,
			folder: { id: 'folder-id', name: 'Exports' }
		});
		expect(get(store).connection).toBeNull();
	});
});
