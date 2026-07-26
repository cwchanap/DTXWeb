import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import en from '../lib/i18n/locales/en.json';
import jp from '../lib/i18n/locales/jp.json';

let messages: Record<string, unknown> = en;
const resolve = (key: string, params?: { values?: Record<string, unknown> }): string => {
	const message = key.split('.').reduce<unknown>((value, part) => {
		return value && typeof value === 'object'
			? (value as Record<string, unknown>)[part]
			: undefined;
	}, messages) as string;
	return message.replace(/\{(\w+)\}/g, (_, name: string) =>
		String(params?.values?.[name] ?? `{${name}}`)
	);
};

vi.mock('svelte-i18n', () => ({
	_: {
		subscribe: (callback: (translate: typeof resolve) => void) => {
			callback(resolve);
			return () => {};
		}
	}
}));

const mockService = vi.hoisted(() => ({
	refreshConnection: vi.fn(),
	connectAndChooseFolder: vi.fn(),
	changeFolder: vi.fn(),
	recheckSharing: vi.fn(),
	disconnect: vi.fn()
}));

vi.mock('../services/googleDriveService', () => ({ googleDriveService: mockService }));

import GoogleDriveSettings from './GoogleDriveSettings.svelte';
import { googleDriveStore } from '../stores/googleDriveStore';

describe('GoogleDriveSettings', () => {
	beforeEach(() => {
		messages = en;
		vi.clearAllMocks();
		googleDriveStore.reset();
		mockService.refreshConnection.mockResolvedValue(null);
	});

	afterEach(() => cleanup());

	it('renders the disconnected connection action through the English locale', () => {
		render(GoogleDriveSettings);
		expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeInTheDocument();
		expect(screen.queryByText('googleDrive.connect')).not.toBeInTheDocument();
	});

	it('renders private-folder and cross-installation warnings through the Japanese locale', () => {
		messages = jp;
		googleDriveStore.setConnection({
			connected: true,
			folder: { id: 'folder-id', name: 'Exports' },
			requiresPublicSharing: true,
			sharingCheckUnavailable: true
		});

		render(GoogleDriveSettings);
		expect(screen.getByText('フォルダーを変更')).toBeInTheDocument();
		expect(screen.getByText(/Exports/)).toBeInTheDocument();
		expect(screen.queryByText('googleDrive.warning.privateSharing')).not.toBeInTheDocument();
		expect(
			screen.queryByText('googleDrive.warning.existingFileAccess')
		).not.toBeInTheDocument();
	});
});
