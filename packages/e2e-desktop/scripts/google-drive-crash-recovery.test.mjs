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
	workspaceVisible: true,
	bridgeReady: true
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
	const session = {
		execute: async () => {
			const probe = probes[Math.min(calls, probes.length - 1)];
			calls += 1;
			return probe;
		}
	};
	const wait = controlledWait();

	const result =
		typeof waitForReloadedWorkspace === 'function'
			? await waitForReloadedWorkspace(session, oldDocument.documentToken, {
					...wait,
					intervalMs: 1,
					timeoutMs: 10
				})
			: undefined;

	expect(result).toEqual(reloadedDocument);
	expect(calls).toBe(4);
});

test('retries a transient navigation-time execute failure within the reload deadline', async () => {
	const outcomes = [new Error('A JavaScript exception occurred'), reloadedDocument];
	let calls = 0;
	const session = {
		execute: async () => {
			const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
			calls += 1;
			if (outcome instanceof Error) throw outcome;
			return outcome;
		}
	};
	const wait = controlledWait();

	const result =
		typeof waitForReloadedWorkspace === 'function'
			? await waitForReloadedWorkspace(session, oldDocument.documentToken, {
					...wait,
					intervalMs: 1,
					timeoutMs: 10
				})
			: undefined;

	expect(result).toEqual(reloadedDocument);
	expect(calls).toBe(2);
});

test('times out with bridge diagnostics instead of accepting a reloaded workspace without IPC', async () => {
	const session = {
		execute: async () => ({
			...reloadedDocument,
			bridgeReady: false
		})
	};
	const wait = controlledWait();
	const result =
		typeof waitForReloadedWorkspace === 'function'
			? waitForReloadedWorkspace(session, oldDocument.documentToken, {
					...wait,
					intervalMs: 1,
					timeoutMs: 3
				})
			: Promise.resolve();

	await expect(result).rejects.toThrow('bridge=missing');
});

test('times out with workspace diagnostics instead of accepting a replacement without content', async () => {
	const session = {
		execute: async () => ({
			...reloadedDocument,
			workspacePresent: false,
			workspaceVisible: false
		})
	};
	const wait = controlledWait();

	await expect(
		waitForReloadedWorkspace(session, oldDocument.documentToken, {
			...wait,
			intervalMs: 1,
			timeoutMs: 3
		})
	).rejects.toThrow('workspace=missing');
});
