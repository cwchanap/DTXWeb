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
import { authStore } from '../stores/authStore';

describe('GoogleDriveSettings', () => {
	beforeEach(() => {
		messages = en;
		vi.clearAllMocks();
		googleDriveStore.reset();
		authStore.setUser({ id: 'user-id', email: 'user@example.com' });
		mockService.refreshConnection.mockResolvedValue(null);
	});

	afterEach(() => cleanup());

	it('hides all Drive settings while Drumery is unauthenticated', () => {
		authStore.logout();
		render(GoogleDriveSettings);
		expect(screen.queryByText('Google Drive uploads')).not.toBeInTheDocument();
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

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

	it('renders verified public-folder and unconfirmed revocation state without identity claims', () => {
		googleDriveStore.setConnection({
			connected: true,
			folder: { id: 'folder-id', name: 'Exports' }
		});
		render(GoogleDriveSettings);
		expect(
			screen.getByText('The selected folder is verified for public download links.')
		).toBeInTheDocument();
		expect(screen.queryByText(/@/)).not.toBeInTheDocument();
		cleanup();

		const generation = googleDriveStore.captureGeneration();
		googleDriveStore.setDisconnectIfCurrent(generation, {
			connection: { connected: false },
			revocationUnconfirmed: true
		});
		render(GoogleDriveSettings);
		expect(
			screen.getByText(
				'Google Account access may still need to be removed from Google Account settings.'
			)
		).toBeInTheDocument();
	});

	it('offers refresh instead of a connect flow when the credential store is unavailable', () => {
		googleDriveStore.setConnection({ connected: false, credentialStoreUnavailable: true });
		render(GoogleDriveSettings);
		expect(screen.getByRole('button', { name: 'Refresh connection' })).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Connect Google Drive' })
		).not.toBeInTheDocument();
	});
});
