import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
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

const mockService = vi.hoisted(() => ({ cancelUpload: vi.fn() }));
vi.mock('../services/googleDriveService', () => ({ googleDriveService: mockService }));

import GoogleDriveUploadStatus from './GoogleDriveUploadStatus.svelte';
import { googleDriveStore } from '../stores/googleDriveStore';

describe('GoogleDriveUploadStatus', () => {
	beforeEach(() => {
		messages = en;
		vi.clearAllMocks();
		googleDriveStore.reset();
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
					status: 'success',
					downloadUrl: 'https://drive.google.com/file/d/example'
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
			props: { outcome: { status: 'failed', errorCode: 'UNSAFE_NATIVE_DETAIL' } }
		});

		expect(screen.getByText('Google Drive upload could not be completed.')).toBeInTheDocument();
		expect(screen.queryByText(/UNSAFE_NATIVE_DETAIL/)).not.toBeInTheDocument();
	});
});
