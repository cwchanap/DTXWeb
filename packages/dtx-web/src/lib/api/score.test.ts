import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, requestMock } = vi.hoisted(() => {
	const mockEnv = { PUBLIC_DTX_API_URL: 'https://api.test' };
	const requestMock = vi.fn();
	return { mockEnv, requestMock };
});

vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token'),
	getAccessToken: vi.fn().mockResolvedValue('test-token')
}));
vi.mock('./transport', () => ({
	makeBrowserClient: () => ({ request: requestMock, url: 'x', requestConfig: { headers: {} } }),
	makeServiceBindingClient: () => ({ request: requestMock })
}));

import { myScoredSimfiles } from './score';

beforeEach(() => {
	requestMock.mockReset();
});

describe('myScoredSimfiles', () => {
	it('adapts the query result and splits scores into best + recent', async () => {
		requestMock.mockResolvedValue({
			myScoredSimfiles: {
				count: 1,
				data: [
					{
						id: '42',
						title: 'Song',
						artist: 'Artist',
						dtxFiles: [
							{
								id: '10',
								label: 'BASIC',
								level: 5,
								myChartScore: {
									playCount: 10,
									clearCount: 4,
									scores: [
										{
											id: '1',
											isBest: true,
											score: 912380,
											achievementRate: 91.3,
											rankLabel: 'S',
											fullCombo: false,
											cleared: true,
											maxCombo: 903,
											perfect: 1300,
											great: 120,
											good: 20,
											poor: 5,
											miss: 5,
											performedAt: 't',
											displayOrder: null
										},
										{
											id: '2',
											isBest: false,
											score: null,
											achievementRate: 82.4,
											rankLabel: 'A',
											fullCombo: false,
											cleared: true,
											maxCombo: null,
											perfect: null,
											great: null,
											good: null,
											poor: null,
											miss: null,
											performedAt: 't',
											displayOrder: 1
										}
									]
								}
							},
							{ id: '11', label: 'EXTREME', level: 8, myChartScore: null }
						]
					}
				]
			}
		});

		const result = await myScoredSimfiles({ page: 1, pageSize: 20 });
		expect(requestMock).toHaveBeenCalledOnce();
		expect(result.count).toBe(1);
		expect(result.data).toHaveLength(1);

		const song = result.data[0];
		expect(song.id).toBe(42);
		expect(song.title).toBe('Song');
		expect(song.charts).toHaveLength(2);

		const withScores = song.charts[0];
		expect(withScores.id).toBe(10);
		expect(withScores.chartScore?.best?.id).toBe(1);
		expect(withScores.chartScore?.best?.score).toBe(912380);
		expect(withScores.chartScore?.best?.isBest).toBe(true);
		expect(withScores.chartScore?.recent).toHaveLength(1);
		expect(withScores.chartScore?.recent[0].displayOrder).toBe(1);

		expect(song.charts[1].chartScore).toBeNull();
	});

	it('defaults page and pageSize when omitted', async () => {
		requestMock.mockResolvedValue({ myScoredSimfiles: { count: 0, data: [] } });
		await myScoredSimfiles();
		const vars = requestMock.mock.calls[0][1] as { page: number; pageSize: number };
		expect(vars.page).toBe(1);
		expect(vars.pageSize).toBe(20);
	});

	// Pins the deliberate fail-loud contract: a non-numeric id (which would
	// imply a broken API/client type contract — D1 PKs are INTEGER) makes the
	// adapter throw rather than silently drop the row. Silently dropping would
	// hide a real schema/type mismatch behind a missing entry. The blast radius
	// (whole page rejects) is acceptable because the precondition is
	// effectively unreachable in production. If you change this to per-row
	// isolation, update this test and the decision record.
	it('throws on a non-numeric simfile id (fail-loud contract)', async () => {
		requestMock.mockResolvedValue({
			myScoredSimfiles: {
				count: 1,
				data: [{ id: 'not-a-number', title: 'Song', artist: 'Artist', dtxFiles: [] }]
			}
		});
		await expect(myScoredSimfiles({ page: 1, pageSize: 20 })).rejects.toThrow(
			/Invalid simfile id/
		);
	});

	it('throws on a non-numeric chart id (fail-loud contract)', async () => {
		requestMock.mockResolvedValue({
			myScoredSimfiles: {
				count: 1,
				data: [
					{
						id: '42',
						title: 'Song',
						artist: 'Artist',
						dtxFiles: [{ id: 'NaN', label: 'BASIC', level: 5, myChartScore: null }]
					}
				]
			}
		});
		await expect(myScoredSimfiles({ page: 1, pageSize: 20 })).rejects.toThrow(
			/Invalid chart id/
		);
	});

	it('throws on a non-numeric score id (fail-loud contract)', async () => {
		requestMock.mockResolvedValue({
			myScoredSimfiles: {
				count: 1,
				data: [
					{
						id: '42',
						title: 'Song',
						artist: 'Artist',
						dtxFiles: [
							{
								id: '10',
								label: 'BASIC',
								level: 5,
								myChartScore: {
									playCount: 1,
									clearCount: 1,
									scores: [
										{
											id: 'bad',
											isBest: true,
											score: 900,
											achievementRate: 90,
											rankLabel: 'A',
											fullCombo: false,
											cleared: true,
											maxCombo: null,
											perfect: null,
											great: null,
											good: null,
											poor: null,
											miss: null,
											performedAt: null,
											displayOrder: null
										}
									]
								}
							}
						]
					}
				]
			}
		});
		await expect(myScoredSimfiles({ page: 1, pageSize: 20 })).rejects.toThrow(
			/Invalid score id/
		);
	});
});
