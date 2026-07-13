import { test, expect } from '@playwright/test';
import { DTX_API_LOCAL_PORT, CHART_B_ID } from './test-config';

test.use({ storageState: 'e2e/.auth/user.json' });

const API_URL = `http://localhost:${DTX_API_LOCAL_PORT}/graphql`;

/**
 * Extract the Supabase access token from the browser's session cookies.
 * The @supabase/ssr browser client stores the session in a cookie named
 * `sb-<project-ref>-auth-token` as a URL-encoded JSON string.
 */
const getAccessToken = async (page: import('@playwright/test').Page): Promise<string> => {
	const cookies = await page.context().cookies();
	const authCookie = cookies.find((c) => /^sb-.+-auth-token$/.test(c.name));
	if (!authCookie) {
		throw new Error('No Supabase auth cookie found. Ensure storageState has a valid session.');
	}
	let parsed: { access_token?: string };
	try {
		parsed = JSON.parse(decodeURIComponent(authCookie.value));
	} catch {
		// Older @supabase/ssr versions may base64-encode the value.
		parsed = JSON.parse(atob(authCookie.value));
	}
	if (!parsed.access_token) {
		throw new Error('Supabase auth cookie has no access_token');
	}
	return parsed.access_token;
};

/**
 * Make an authenticated GraphQL request to the local dtx-api worker.
 */
const graphqlRequest = async <T>(
	page: import('@playwright/test').Page,
	token: string,
	query: string,
	variables?: Record<string, unknown>
): Promise<T> => {
	const res = await page.request.post(API_URL, {
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`
		},
		data: { query, variables }
	});
	expect(res.ok(), `GraphQL request failed: ${res.status()}`).toBe(true);
	const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
	if (body.errors && body.errors.length > 0) {
		throw new Error(`GraphQL errors: ${body.errors.map((e) => e.message).join(', ')}`);
	}
	if (!body.data) {
		throw new Error('GraphQL response missing data');
	}
	return body.data;
};

// The score payload mirrors what the desktop app's buildUpload() produces from
// parse_dtxmania_scores output — one best row (isBest=true, no displayOrder)
// and two recent rows (displayOrder 1..2). See Scores.svelte:271-317 and
// scores.rs ScorePayload for the shape.
const SCORE_PAYLOAD = {
	charts: [
		{
			chartId: '', // filled at runtime from the dtx_files query
			playCount: 12,
			clearCount: 8,
			scores: [
				{
					isBest: true,
					score: 983400,
					achievementRate: 98.34,
					rankLabel: 'SS',
					fullCombo: false,
					cleared: true,
					maxCombo: 432,
					perfect: 210,
					great: 180,
					good: 30,
					poor: 12,
					miss: 8,
					performedAt: null,
					displayOrder: null
				},
				{
					isBest: false,
					score: 921000,
					achievementRate: 92.1,
					rankLabel: 'S',
					fullCombo: false,
					cleared: true,
					maxCombo: 401,
					perfect: 190,
					great: 160,
					good: 35,
					poor: 10,
					miss: 15,
					performedAt: '2025-06-01T10:00:00Z',
					displayOrder: 1
				},
				{
					isBest: false,
					score: 855000,
					achievementRate: 85.5,
					rankLabel: 'S',
					fullCombo: false,
					cleared: false,
					maxCombo: 350,
					perfect: 160,
					great: 140,
					good: 40,
					poor: 20,
					miss: 30,
					performedAt: '2025-05-28T18:30:00Z',
					displayOrder: 2
				}
			]
		}
	]
};

test.describe('score upload round-trip (uploadScores → myScoredSimfiles)', () => {
	test.describe.configure({ retries: 0 });

	test('upload scores for a seeded chart and verify they appear in myScoredSimfiles', async ({
		page
	}) => {
		// Navigate to /app so the Supabase session cookies are loaded.
		await page.goto('/app');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');

		const token = await getAccessToken(page);

		// 1. Query the seeded simfile to get its dtx_files id (the chartId for
		//    uploadScores). CHART_B_ID (1002) is published with one BASIC dtx_file.
		const simfileQuery = `
			query GetSimfile($id: ID!) {
				simfile(id: $id) {
					id
					title
					dtxFiles {
						id
						label
						level
					}
				}
			}`;
		const simfileData = await graphqlRequest<{
			simfile: {
				id: string;
				title: string;
				dtxFiles: { id: string; label: string; level: number }[];
			};
		}>(page, token, simfileQuery, { id: String(CHART_B_ID) });

		expect(simfileData.simfile).not.toBeNull();
		expect(simfileData.simfile.dtxFiles.length).toBeGreaterThan(0);
		const chartId = simfileData.simfile.dtxFiles[0].id;

		// 2. Upload scores via the uploadScores mutation with a payload shaped
		//    like buildUpload() output.
		const uploadMutation = `
			mutation UploadScores($input: UploadScoresInput!) {
				uploadScores(input: $input) {
					updatedCharts
					insertedScores
					skipped {
						chartId
						reason
					}
				}
			}`;
		const uploadInput = {
			...SCORE_PAYLOAD,
			charts: [{ ...SCORE_PAYLOAD.charts[0], chartId }]
		};
		const uploadData = await graphqlRequest<{
			uploadScores: {
				updatedCharts: number;
				insertedScores: number;
				skipped: { chartId: string; reason: string }[];
			};
		}>(page, token, uploadMutation, { input: uploadInput });

		expect(uploadData.uploadScores.updatedCharts).toBe(1);
		expect(uploadData.uploadScores.insertedScores).toBe(3);
		expect(uploadData.uploadScores.skipped).toEqual([]);

		// 3. Query myScoredSimfiles and verify the chart appears with the scores.
		const scoredQuery = `
			query MyScoredSimfiles {
				myScoredSimfiles {
					count
					data {
						id
						title
						dtxFiles {
							id
							label
							level
							myChartScore {
								id
								playCount
								clearCount
								scores {
									id
									isBest
									score
									achievementRate
									rankLabel
									fullCombo
									cleared
									maxCombo
									perfect
									great
									good
									poor
									miss
									performedAt
									displayOrder
								}
							}
						}
					}
				}
			}`;
		const scoredData = await graphqlRequest<{
			myScoredSimfiles: {
				count: number;
				data: {
					id: string;
					title: string;
					dtxFiles: {
						id: string;
						label: string;
						level: number;
						myChartScore: {
							id: string;
							playCount: number;
							clearCount: number;
							scores: {
								id: string;
								isBest: boolean;
								score: number | null;
								achievementRate: number | null;
								rankLabel: string | null;
								fullCombo: boolean;
								cleared: boolean;
								maxCombo: number | null;
								perfect: number | null;
								great: number | null;
								good: number | null;
								poor: number | null;
								miss: number | null;
								performedAt: string | null;
								displayOrder: number | null;
							}[];
						} | null;
					}[];
				}[];
			};
		}>(page, token, scoredQuery);

		expect(scoredData.myScoredSimfiles.count).toBeGreaterThanOrEqual(1);
		const chart = scoredData.myScoredSimfiles.data.find((s) => s.id === String(CHART_B_ID));
		expect(chart).toBeDefined();
		expect(chart!.title).toBe('E2E Download Chart');

		const dtxFile = chart!.dtxFiles.find((f) => f.id === chartId);
		expect(dtxFile).toBeDefined();
		expect(dtxFile!.myChartScore).not.toBeNull();
		const chartScore = dtxFile!.myChartScore!;
		expect(chartScore.playCount).toBe(12);
		expect(chartScore.clearCount).toBe(8);
		expect(chartScore.scores).toHaveLength(3);

		// Verify the best score.
		const bestScore = chartScore.scores.find((s) => s.isBest);
		expect(bestScore).toBeDefined();
		expect(bestScore!.score).toBe(983400);
		expect(bestScore!.achievementRate).toBeCloseTo(98.34, 2);
		expect(bestScore!.rankLabel).toBe('SS');
		expect(bestScore!.fullCombo).toBe(false);
		expect(bestScore!.cleared).toBe(true);
		expect(bestScore!.displayOrder).toBeNull();

		// Verify the recent scores are ordered by displayOrder.
		const recentScores = chartScore.scores
			.filter((s) => !s.isBest)
			.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
		expect(recentScores).toHaveLength(2);
		expect(recentScores[0].displayOrder).toBe(1);
		expect(recentScores[0].score).toBe(921000);
		expect(recentScores[1].displayOrder).toBe(2);
		expect(recentScores[1].score).toBe(855000);
		expect(recentScores[1].cleared).toBe(false);
	});
});
