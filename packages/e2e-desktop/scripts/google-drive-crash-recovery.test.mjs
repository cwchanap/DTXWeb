import { expect, test } from 'bun:test';

const { assertRecoveredDriveSnapshot } = await import('./google-drive-crash-recovery.ts');

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
