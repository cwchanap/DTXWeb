import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => {
	const mockEnv = { PUBLIC_USE_GRAPHQL_API: 'false', PUBLIC_DTX_API_URL: 'https://api.test' };
	return { mockEnv };
});

vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token')
}));

import {
	bulkDownloadBaseUrl,
	downloadBaseUrl,
	parseContentDispositionFilename,
	downloadSimfile
} from './download';

beforeEach(() => {
	mockEnv.PUBLIC_USE_GRAPHQL_API = 'false';
	mockEnv.PUBLIC_DTX_API_URL = 'https://api.test';
});

describe('bulkDownloadBaseUrl', () => {
	it('returns dtx-web local URL when flag OFF', () => {
		expect(bulkDownloadBaseUrl()).toBe('/api/simFile/download/bulk');
	});
	it('returns dtx-api URL when flag ON', () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		expect(bulkDownloadBaseUrl()).toBe('https://api.test/downloads/bulk');
	});
	it('throws when GraphQL mode ON and PUBLIC_DTX_API_URL is empty', () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		mockEnv.PUBLIC_DTX_API_URL = '';
		expect(() => bulkDownloadBaseUrl()).toThrow('PUBLIC_DTX_API_URL is not configured');
	});
});

describe('downloadBaseUrl', () => {
	it('returns relative REST URL when flag OFF', () => {
		expect(downloadBaseUrl('7')).toBe('/api/simFile/download/7');
	});
	it('throws when GraphQL mode ON and PUBLIC_DTX_API_URL is empty', () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		mockEnv.PUBLIC_DTX_API_URL = '';
		expect(() => downloadBaseUrl('7')).toThrow('PUBLIC_DTX_API_URL is not configured');
	});
});

describe('parseContentDispositionFilename', () => {
	it('extracts quoted filename', () => {
		expect(parseContentDispositionFilename('attachment; filename="chart-7.zip"')).toBe(
			'chart-7.zip'
		);
	});
	it('extracts unquoted filename', () => {
		expect(parseContentDispositionFilename('attachment; filename=chart-7.zip')).toBe(
			'chart-7.zip'
		);
	});
	it('returns null for missing header', () => {
		expect(parseContentDispositionFilename(null)).toBeNull();
		expect(parseContentDispositionFilename('attachment')).toBeNull();
	});
	it('URL-decodes RFC5987 filename* values', () => {
		expect(
			parseContentDispositionFilename(
				"attachment; filename*=UTF-8''%E3%83%86%E3%82%B9%E3%83%88.zip"
			)
		).toBe('テスト.zip');
	});
	it('falls back to raw value when RFC5987 decoding fails', () => {
		expect(parseContentDispositionFilename("attachment; filename*=UTF-8''%E0%A4%A.zip")).toBe(
			'%E0%A4%A.zip'
		);
	});
});

describe('downloadSimfile (REST path)', () => {
	it('triggers direct download without buffering', async () => {
		const fetchMock = vi.fn();
		const directDownloadSpy = vi.fn();
		await downloadSimfile('3', {
			fetchFn: fetchMock,
			directDownloadFn: directDownloadSpy
		});
		expect(directDownloadSpy).toHaveBeenCalledWith('/api/simFile/download/3');
		// fetch should NOT be called for REST path
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not call fetchFn for REST path', async () => {
		const fetchMock = vi.fn();
		const triggerSpy = vi.fn();
		await downloadSimfile('3', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(triggerSpy).not.toHaveBeenCalled();
	});
});

describe('downloadSimfile (GraphQL path)', () => {
	beforeEach(() => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
	});

	it('hits dtx-api URL with bearer header when token available', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
		const triggerSpy = vi.fn();
		await downloadSimfile('3', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		expect(fetchMock).toHaveBeenCalledWith('https://api.test/downloads/3', expect.any(Object));
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
	});
});
