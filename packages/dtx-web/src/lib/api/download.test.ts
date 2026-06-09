import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => {
	const mockEnv = { PUBLIC_DTX_API_URL: 'https://api.test' };
	return { mockEnv };
});

vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token')
}));

import {
	bulkDownloadBaseUrl,
	bulkDownloadHeaders,
	downloadBaseUrl,
	parseContentDispositionFilename,
	downloadSimfile
} from './download';

beforeEach(() => {
	mockEnv.PUBLIC_DTX_API_URL = 'https://api.test';
});

describe('downloadBaseUrl', () => {
	it('returns the dtx-api URL', () => {
		expect(downloadBaseUrl('7')).toBe('https://api.test/downloads/7');
	});
	it('throws when PUBLIC_DTX_API_URL is empty', () => {
		mockEnv.PUBLIC_DTX_API_URL = '';
		expect(() => downloadBaseUrl('7')).toThrow('PUBLIC_DTX_API_URL is not configured');
	});
});

describe('bulkDownloadBaseUrl', () => {
	it('returns the dtx-api bulk URL', () => {
		expect(bulkDownloadBaseUrl()).toBe('https://api.test/downloads/bulk');
	});
	it('throws when PUBLIC_DTX_API_URL is empty', () => {
		mockEnv.PUBLIC_DTX_API_URL = '';
		expect(() => bulkDownloadBaseUrl()).toThrow('PUBLIC_DTX_API_URL is not configured');
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

describe('downloadSimfile', () => {
	it('hits the dtx-api URL with a bearer header when token available', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
		const triggerSpy = vi.fn();
		await downloadSimfile('3', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		expect(fetchMock).toHaveBeenCalledWith('https://api.test/downloads/3', expect.any(Object));
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
	});

	it('throws on non-ok response', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('fail', { status: 500 }));
		await expect(downloadSimfile('3', { fetchFn: fetchMock })).rejects.toThrow(
			'Download failed: 500'
		);
	});

	it('omits Authorization header when token is null', async () => {
		const { getAccessTokenOrNull } = await import('./token');
		vi.mocked(getAccessTokenOrNull).mockResolvedValueOnce(null);
		const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
		const triggerSpy = vi.fn();
		await downloadSimfile('3', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
	});

	it('uses chart-{simfileId}.zip fallback when content-disposition is null', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('blob-data'));
		const triggerSpy = vi.fn();
		await downloadSimfile('42', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		const [, filename] = triggerSpy.mock.calls[0];
		expect(filename).toBe('chart-42.zip');
	});
});

describe('bulkDownloadHeaders', () => {
	it('returns Content-Type and Authorization when token available', async () => {
		const headers = await bulkDownloadHeaders();
		expect(headers).toEqual({
			'Content-Type': 'application/json',
			Authorization: 'Bearer test-token'
		});
	});

	it('returns Content-Type only when no token', async () => {
		const { getAccessTokenOrNull } = await import('./token');
		vi.mocked(getAccessTokenOrNull).mockResolvedValueOnce(null);
		const headers = await bulkDownloadHeaders();
		expect(headers).toEqual({ 'Content-Type': 'application/json' });
	});
});
