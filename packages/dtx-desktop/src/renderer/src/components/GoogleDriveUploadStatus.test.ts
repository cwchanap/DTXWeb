import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import en from '../lib/i18n/locales/en.json';
import jp from '../lib/i18n/locales/jp.json';

let messages: Record<string, unknown> = en;
const resolve = (key: string): string =>
	key.split('.').reduce<unknown>((value, part) => {
		return value && typeof value === 'object'
			? (value as Record<string, unknown>)[part]
			: undefined;
	}, messages) as string;

vi.mock('svelte-i18n', () => ({
	_: {
		subscribe: (callback: (translate: (key: string) => string) => void) => {
			callback(resolve);
			return () => {};
		}
	}
}));

const mockService = vi.hoisted(() => ({
	cancelUpload: vi.fn(),
	connectAndChooseFolder: vi.fn(),
	changeFolder: vi.fn(),
	recheckSharing: vi.fn(),
	refreshConnection: vi.fn()
}));
vi.mock('../services/googleDriveService', () => ({ googleDriveService: mockService }));

import GoogleDriveUploadStatus from './GoogleDriveUploadStatus.svelte';
import { googleDriveStore } from '../stores/googleDriveStore';
import { authStore } from '../stores/authStore';

describe('GoogleDriveUploadStatus', () => {
	beforeEach(() => {
		messages = en;
		vi.clearAllMocks();
		googleDriveStore.reset();
		authStore.setUser({ id: 'user-id', email: 'user@example.com' });
		mockService.cancelUpload.mockResolvedValue(true);
	});

	afterEach(() => cleanup());

	it('renders upload progress and cancels the active operation', async () => {
		googleDriveStore.beginOperation('operation-id', 'simfile-id');
		googleDriveStore.applyProgress({
			operationId: 'operation-id',
			simfileId: 'simfile-id',
			stage: 'uploading',
			percentage: 42
		});

		render(GoogleDriveUploadStatus);
		expect(screen.getByText('Uploading to Google Drive')).toBeInTheDocument();
		expect(screen.getByText('42%')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));
		expect(mockService.cancelUpload).toHaveBeenCalledWith('operation-id');
	});

	it('renders the Google Drive browser-link warning through the Japanese locale', () => {
		messages = jp;
		render(GoogleDriveUploadStatus, {
			props: {
				outcome: {
					simfileId: 'simfile-id',
					result: {
						status: 'success',
						downloadUrl: 'https://drive.google.com/file/d/example'
					}
				}
			}
		});

		expect(screen.queryByText('googleDrive.upload.browserLink')).not.toBeInTheDocument();
		expect(screen.getByRole('link')).toHaveAttribute(
			'href',
			'https://drive.google.com/file/d/example'
		);
	});

	it('does not expose an unknown native error code as renderer text', () => {
		render(GoogleDriveUploadStatus, {
			props: {
				outcome: {
					simfileId: 'simfile-id',
					result: { status: 'failed', errorCode: 'UNSAFE_NATIVE_DETAIL' }
				}
			}
		});

		expect(screen.getByText('Google Drive upload could not be completed.')).toBeInTheDocument();
		expect(screen.queryByText(/UNSAFE_NATIVE_DETAIL/)).not.toBeInTheDocument();
	});

	it('hides outcome links and recovery actions after logout while mounted', async () => {
		googleDriveStore.beginOperation('operation-id', 'simfile-id');
		render(GoogleDriveUploadStatus, {
			props: {
				outcome: {
					simfileId: 'simfile-id',
					result: {
						status: 'failed',
						errorCode: 'NOT_CONNECTED'
					}
				}
			}
		});
		expect(screen.getByRole('button', { name: 'Reconnect Google Drive' })).toBeInTheDocument();

		authStore.logout();

		await waitFor(() => {
			expect(
				screen.queryByRole('button', { name: 'Reconnect Google Drive' })
			).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Cancel upload' })).not.toBeInTheDocument();
		});
	});

	it.each([
		['waiting-for-upload-slot', true],
		['preparing-zip', true],
		['connecting-to-google-drive', true],
		['uploading', true],
		['finalizing', false],
		['synchronizing-download-metadata', false],
		['upload-complete', false],
		['upload-failed-save-succeeded', false]
	] as const)('shows cancellation only during %s when it is safe', (stage, cancelable) => {
		googleDriveStore.beginOperation('operation-id', 'simfile-id');
		googleDriveStore.applyProgress({
			operationId: 'operation-id',
			simfileId: 'simfile-id',
			stage
		});

		render(GoogleDriveUploadStatus);
		if (cancelable) {
			expect(screen.getByRole('button', { name: 'Cancel upload' })).toBeInTheDocument();
		} else {
			expect(screen.queryByRole('button', { name: 'Cancel upload' })).not.toBeInTheDocument();
		}
	});

	it('renders both in-flight operations and cancels only the selected one', async () => {
		googleDriveStore.beginOperation('operation-a', 'simfile-a');
		googleDriveStore.beginOperation('operation-b', 'simfile-b');
		googleDriveStore.applyProgress({
			operationId: 'operation-a',
			simfileId: 'simfile-a',
			stage: 'uploading',
			percentage: 25
		});
		googleDriveStore.applyProgress({
			operationId: 'operation-b',
			simfileId: 'simfile-b',
			stage: 'preparing-zip'
		});

		render(GoogleDriveUploadStatus);
		expect(screen.getAllByRole('button', { name: 'Cancel upload' })).toHaveLength(2);
		await fireEvent.click(screen.getAllByRole('button', { name: 'Cancel upload' })[1]);
		expect(mockService.cancelUpload).toHaveBeenCalledWith('operation-b');
	});

	it('shows only operations and remediation bound to the authoritative simfile', () => {
		googleDriveStore.beginOperation('operation-a', 'simfile-a');
		googleDriveStore.beginOperation('operation-b', 'simfile-b');
		googleDriveStore.applyProgress({
			operationId: 'operation-a',
			simfileId: 'simfile-a',
			stage: 'uploading',
			percentage: 25
		});
		googleDriveStore.applyProgress({
			operationId: 'operation-b',
			simfileId: 'simfile-b',
			stage: 'preparing-zip'
		});

		render(GoogleDriveUploadStatus, {
			props: {
				simfileId: 'simfile-b',
				outcome: {
					simfileId: 'simfile-a',
					result: { status: 'failed', errorCode: 'FILE_NOT_FOUND' }
				}
			}
		});

		expect(screen.getByText('Preparing ZIP for Google Drive')).toBeInTheDocument();
		expect(screen.queryByText('25%')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Reconnect Google Drive' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Create a replacement upload' })).toBeNull();
	});

	it.each([
		['WORKSPACE_REQUIRED', []],
		['NOT_CONNECTED', ['Reconnect Google Drive']],
		['RECONNECT_REQUIRED', ['Reconnect Google Drive']],
		['FOLDER_REQUIRED', ['Change folder']],
		['FOLDER_UNAVAILABLE', ['Change folder']],
		['SHARING_CHECK_UNAVAILABLE', ['Re-check sharing']],
		['DOWNLOAD_NOT_PUBLIC', ['Re-check sharing']],
		['SIMFILE_UNAVAILABLE', []],
		['FILE_NOT_FOUND', ['Reconnect Google Drive', 'Create a replacement upload']],
		['FILE_PERMISSION_DENIED', ['Reconnect Google Drive', 'Create a replacement upload']],
		['UPLOAD_IN_PROGRESS', ['Retry Google Drive upload']],
		['CANCELED', ['Retry Google Drive upload']],
		['NO_VALID_SONG_FILES', []],
		['INSUFFICIENT_DISK_SPACE', []],
		['LOCAL_STATE', ['Retry Google Drive upload']],
		['METADATA_SYNC_FAILED', ['Retry Google Drive upload']],
		['RATE_LIMITED', ['Retry Google Drive upload']],
		['QUOTA_EXCEEDED', ['Retry Google Drive upload']],
		['NETWORK', ['Retry Google Drive upload']],
		['CREDENTIAL_STORE', ['Refresh connection']],
		['INVALID_RESPONSE', []],
		['UNKNOWN', []]
	] as const)('renders sanitized remediation for native %s', (errorCode, actionNames) => {
		render(GoogleDriveUploadStatus, {
			props: {
				outcome: {
					simfileId: 'simfile-id',
					result: { status: 'failed', errorCode }
				},
				onRetry: () => {},
				onCreateReplacement: () => {}
			}
		});

		expect(screen.getByText(resolve(`googleDrive.error.${errorCode}`))).toBeInTheDocument();
		expect(screen.queryAllByRole('button')).toHaveLength(actionNames.length);
		for (const actionName of actionNames) {
			expect(screen.getByRole('button', { name: actionName })).toBeInTheDocument();
		}
	});

	it('refreshes the connection after keychain recovery without opening OAuth reconnect', async () => {
		render(GoogleDriveUploadStatus, {
			props: {
				outcome: {
					simfileId: 'simfile-id',
					result: { status: 'failed', errorCode: 'CREDENTIAL_STORE' }
				}
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Refresh connection' }));
		expect(mockService.refreshConnection).toHaveBeenCalledOnce();
		expect(mockService.connectAndChooseFolder).not.toHaveBeenCalled();
	});
});
