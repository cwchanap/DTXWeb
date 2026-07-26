import { expect, test } from 'bun:test';

const { assertRecoveredDriveSnapshot, waitForReloadedWorkspace } =
	await import('./google-drive-crash-recovery.ts');

const recovered = {
	owner: {
		simfileId: '311001',
		cloudTitle: 'Critical Workspace Song',
		googleDriveFileId: 'e2e-drive-file-0001',
		downloadUrl: 'https://drive.google.test/download/e2e-drive-file-0001'
	},
	objects: [
		{
			fileId: 'e2e-drive-file-0001',
			name: 'Critical Workspace Song.zip',
			webContentLink: 'https://drive.google.test/download/e2e-drive-file-0001',
			zipEntries: [],
			creationCount: 1
		}
	],
	calls: [],
	metadataMutations: [],
	progress: [],
	generateCount: 0,
	createCount: 0,
	updateCount: 0,
	deleteCount: 0,
	lifetimeCreateCount: 1,
	publicPermission: true
};

test('accepts same-ID restart recovery without a second create', () => {
	expect(() => assertRecoveredDriveSnapshot(recovered)).not.toThrow();
});

test('rejects a duplicate create after restart', () => {
	expect(() =>
		assertRecoveredDriveSnapshot({
			...recovered,
			objects: [...recovered.objects, { ...recovered.objects[0], fileId: 'duplicate' }],
			lifetimeCreateCount: 2
		})
	).toThrow('exactly one persisted Drive object');
});

const oldDocument = {
	documentToken: 'old-document',
	readyState: 'complete',
	workspacePresent: true,
	workspaceVisible: true
};

const reloadedDocument = {
	...oldDocument,
	documentToken: null
};

const controlledWait = () => {
	let time = 0;
	return {
		now: () => time,
		sleep: async (milliseconds) => {
			time += Math.max(milliseconds, 1);
		}
	};
};

test('does not accept the old document or an incomplete replacement document', async () => {
	const probes = [
		oldDocument,
		{ ...reloadedDocument, readyState: 'loading' },
		{ ...reloadedDocument, workspaceVisible: false },
		reloadedDocument
	];
	let calls = 0;
	let nativeCalls = 0;
	const session = {
		tauri: {
			execute: async (script) => {
				if (script.toString().includes('snapshot_google_drive_e2e')) {
					nativeCalls += 1;
					return recovered;
				}
				const probe = probes[Math.min(calls, probes.length - 1)];
				calls += 1;
				return probe;
			}
		}
	};
	const wait = controlledWait();

	const result = await waitForReloadedWorkspace(session, oldDocument.documentToken, {
		...wait,
		intervalMs: 1,
		timeoutMs: 10
	});

	expect(result).toEqual(reloadedDocument);
	expect(calls).toBe(4);
	expect(nativeCalls).toBe(1);
});

test('retries a transient navigation-time execute failure within the reload deadline', async () => {
	const outcomes = [new Error('A JavaScript exception occurred'), reloadedDocument];
	let calls = 0;
	const session = {
		tauri: {
			execute: async (script) => {
				if (script.toString().includes('snapshot_google_drive_e2e')) return recovered;
				const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
				calls += 1;
				if (outcome instanceof Error) throw outcome;
				return outcome;
			}
		}
	};
	const wait = controlledWait();

	const result = await waitForReloadedWorkspace(session, oldDocument.documentToken, {
		...wait,
		intervalMs: 1,
		timeoutMs: 10
	});

	expect(result).toEqual(reloadedDocument);
	expect(calls).toBe(2);
});

test('uses the standalone direct evaluator for reload probes after navigation', async () => {
	let directCalls = 0;
	const session = {
		execute: async () => {
			throw new Error('standard WebDriver execute must not probe a reloading document');
		},
		tauri: {
			execute: async (script) => {
				if (script.toString().includes('snapshot_google_drive_e2e')) return recovered;
				directCalls += 1;
				return reloadedDocument;
			}
		}
	};
	const wait = controlledWait();

	const result = await waitForReloadedWorkspace(session, oldDocument.documentToken, {
		...wait,
		intervalMs: 1,
		timeoutMs: 10
	});

	expect(result).toEqual(reloadedDocument);
	expect(directCalls).toBe(1);
});

test('retries a callable native bridge that rejects before accepting live IPC', async () => {
	const nativeOutcomes = [new Error('native bridge is still loading'), recovered];
	let nativeCalls = 0;
	const session = {
		tauri: {
			execute: async (script) => {
				if (!script.toString().includes('snapshot_google_drive_e2e')) {
					return reloadedDocument;
				}
				const outcome = nativeOutcomes[Math.min(nativeCalls, nativeOutcomes.length - 1)];
				nativeCalls += 1;
				if (outcome instanceof Error) throw outcome;
				return outcome;
			}
		}
	};
	const wait = controlledWait();

	const result = await waitForReloadedWorkspace(session, oldDocument.documentToken, {
		...wait,
		intervalMs: 1,
		timeoutMs: 10
	});

	expect(result).toEqual(reloadedDocument);
	expect(nativeCalls).toBe(2);
});

test('times out with the last native error when a callable bridge keeps rejecting', async () => {
	const session = {
		tauri: {
			execute: async (script) => {
				if (!script.toString().includes('snapshot_google_drive_e2e')) {
					return reloadedDocument;
				}
				throw new Error('snapshot IPC rejected');
			}
		}
	};
	const wait = controlledWait();

	await expect(
		waitForReloadedWorkspace(session, oldDocument.documentToken, {
			...wait,
			intervalMs: 1,
			timeoutMs: 3
		})
	).rejects.toThrow('lastNativeError=snapshot IPC rejected');
});

test('bounds a native bridge probe that never settles', async () => {
	const session = {
		tauri: {
			execute: async (script) => {
				if (!script.toString().includes('snapshot_google_drive_e2e')) {
					return reloadedDocument;
				}
				return await new Promise(() => {});
			}
		}
	};

	await expect(
		waitForReloadedWorkspace(session, oldDocument.documentToken, {
			intervalMs: 1,
			timeoutMs: 5
		})
	).rejects.toThrow('native=timed-out');
});

test('times out with workspace diagnostics instead of accepting a replacement without content', async () => {
	let nativeCalls = 0;
	const session = {
		tauri: {
			execute: async (script) => {
				if (script.toString().includes('snapshot_google_drive_e2e')) {
					nativeCalls += 1;
					return recovered;
				}
				return {
					...reloadedDocument,
					workspacePresent: false,
					workspaceVisible: false
				};
			}
		}
	};
	const wait = controlledWait();

	await expect(
		waitForReloadedWorkspace(session, oldDocument.documentToken, {
			...wait,
			intervalMs: 1,
			timeoutMs: 3
		})
	).rejects.toThrow('workspace=missing');
	expect(nativeCalls).toBe(0);
});
