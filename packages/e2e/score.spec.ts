import { test, expect, type Page } from '@playwright/test';
import { DTX_API_LOCAL_PORT, CHART_B_ID } from './test-config';
import type { UploadScoresInput } from '../dtx-web/src/lib/api/generated/graphql';

// Both describe blocks destructively REPLACE the test user's scores on the
// same seeded chart (CHART_B_ID). Running them as separate files let
// Playwright parallelize them across workers, so each could observe the
// other's payload and flake (score-upload asserts insertedScores===3 /
// playCount===12; score-page asserts the 987650 best score). Serial mode
// runs every test in this file on a single worker, in order, so the two
// writes can no longer interleave. retries:0 is preserved from the originals.
test.use({ storageState: '.auth/user.json' });
test.describe.configure({ mode: 'serial', retries: 0 });

const API_URL = `http://localhost:${DTX_API_LOCAL_PORT}/graphql`;

/**
 * Extract the Supabase access token from the browser's session cookies.
 * The @supabase/ssr browser client stores the session in a cookie named
 * `sb-<project-ref>-auth-token`. Encoding varies by @supabase/ssr version
 * (URL-encoded JSON, plain base64, or base64url with a "base64-" prefix), so
 * each form is tried in order.
 */
const getAccessToken = async (page: Page): Promise<string> => {
	const cookies = await page.context().cookies();
	// @supabase/ssr stores the session as a single cookie when it fits, or as
	// chunked cookies (`sb-...-auth-token.0`, `.1`, ...) when the value exceeds
	// the ~3180-byte chunk limit. Prefer the single cookie; otherwise reassemble
	// chunks in index order.
	const single = cookies.find((c) => /^sb-.+-auth-token$/.test(c.name));
	let rawValue = single?.value;
	if (!rawValue) {
		const chunks = cookies
			.filter((c) => /^sb-.+-auth-token\.\d+$/.test(c.name))
			.sort((a, b) => {
				const aIndex = Number(a.name.slice(a.name.lastIndexOf('.') + 1));
				const bIndex = Number(b.name.slice(b.name.lastIndexOf('.') + 1));
				return aIndex - bIndex;
			});
		if (chunks.length === 0) {
			throw new Error(
				'No Supabase auth cookie found. Ensure storageState has a valid session.'
			);
		}
		rawValue = chunks.map((c) => c.value).join('');
	}
	let parsed: { access_token?: string };
	try {
		parsed = JSON.parse(decodeURIComponent(rawValue));
	} catch {
		try {
			parsed = JSON.parse(atob(rawValue));
		} catch {
			// base64url ("-" / "_" alphabet) with a "base64-" prefix, as used
			// by @supabase/ssr 0.5+. Strip the prefix and remap to the base64
			// alphabet that atob understands before decoding.
			const raw = rawValue.startsWith('base64-')
				? rawValue.slice('base64-'.length)
				: rawValue;
			const remapped = raw.replace(/-/g, '+').replace(/_/g, '/');
			parsed = JSON.parse(atob(remapped));
		}
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
	page: Page,
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

// Mirrors buildUpload() output: one best row (isBest=true, no displayOrder)
// and two recent rows (displayOrder 1..2). See Scores.svelte and scores.rs
// ScorePayload for the shape.
const ROUND_TRIP_PAYLOAD = {
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

// One best row + one recent row, matching the buildUpload() shape.
const scorePagePayload = (chartId: string): UploadScoresInput => ({
	charts: [
		{
			chartId,
			playCount: 5,
			clearCount: 3,
			scores: [
				{
					isBest: true,
					score: 987650,
					achievementRate: 98.77,
					rankLabel: 'SS',
					fullCombo: true,
					cleared: true,
					maxCombo: 500,
					perfect: 250,
					great: 200,
					good: 30,
					poor: 10,
					miss: 5,
					performedAt: null,
					displayOrder: null
				},
				{
					isBest: false,
					score: 920000,
					achievementRate: 92.0,
					rankLabel: 'S',
					fullCombo: false,
					cleared: true,
					maxCombo: 400,
					perfect: 190,
					great: 160,
					good: 35,
					poor: 10,
					miss: 15,
					performedAt: '2025-06-01T10:00:00Z',
					displayOrder: 1
				}
			]
		}
	]
});

test.describe('score upload round-trip (uploadScores → myScoredSimfiles)', () => {
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
			...ROUND_TRIP_PAYLOAD,
			charts: [{ ...ROUND_TRIP_PAYLOAD.charts[0], chartId }]
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

test.describe('Score page UI (/app/score)', () => {
	test('renders uploaded scores in the score page UI', async ({ page }) => {
		// Navigate to /app so the Supabase session cookies are loaded.
		await page.goto('/app');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');

		const token = await getAccessToken(page);

		// 1. Query the seeded simfile to get its dtx_files id (the chartId).
		const simfileQuery = `
			query GetSimfile($id: ID!) {
				simfile(id: $id) {
					id
					dtxFiles { id label level }
				}
			}`;
		const simfileData = await graphqlRequest<{
			simfile: { dtxFiles: { id: string; label: string; level: number }[] };
		}>(page, token, simfileQuery, { id: String(CHART_B_ID) });
		expect(simfileData.simfile.dtxFiles.length).toBeGreaterThan(0);
		const chartId = simfileData.simfile.dtxFiles[0].id;
		const chartLabel = simfileData.simfile.dtxFiles[0].label;

		// 2. Upload scores via GraphQL (same path as the desktop app).
		const uploadMutation = `
			mutation UploadScores($input: UploadScoresInput!) {
				uploadScores(input: $input) {
					updatedCharts
					insertedScores
					skipped { chartId reason }
				}
			}`;
		const uploadData = await graphqlRequest<{
			uploadScores: { updatedCharts: number; skipped: { chartId: string; reason: string }[] };
		}>(page, token, uploadMutation, { input: scorePagePayload(chartId) });
		expect(uploadData.uploadScores.updatedCharts).toBe(1);
		expect(uploadData.uploadScores.skipped).toEqual([]);

		// 3. Navigate to the /app/score page and verify the UI renders the
		//    uploaded scores — not just a GraphQL round-trip, but the actual
		//    rendered ScoreCard with the song title, chart label, best score,
		//    and recent play.
		await page.goto('/app/score');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');

		// The page heading is always present (localized English locale).
		await expect(page.getByRole('heading', { name: 'My Scores' })).toBeVisible();

		// The seeded chart title should appear in a ScoreCard.
		await expect(page.getByText('E2E Download Chart')).toBeVisible();

		// Scope subsequent assertions to the seeded card so rank/FC badges
		// don't accidentally match a different card's badges (the previous
		// getByText('SS').first() was fragile if multiple cards rendered).
		const card = page.locator('.music-card', { hasText: 'E2E Download Chart' });

		// The chart label badge should render (e.g. "BASIC · score.level_short N").
		await expect(card.getByText(new RegExp(chartLabel))).toBeVisible();

		// The best score value should be visible (987,650 formatted by locale).
		// Use a flexible matcher since locale formatting varies.
		await expect(card.getByText(/987.?650/)).toBeVisible();

		// The SS rank badge should appear.
		await expect(card.getByText('SS', { exact: true })).toBeVisible();

		// The FC (full combo) badge should appear.
		await expect(card.getByText('FC')).toBeVisible();
	});

	test('loads the score page without crashing when there are scores', async ({ page }) => {
		// Smoke: navigate directly to /app/score and verify the page hydrates
		// and renders the heading. Scores may or may not exist from prior tests,
		// but the page must not crash either way.
		await page.goto('/app/score');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		await expect(page.getByRole('heading', { name: 'My Scores' })).toBeVisible();
	});
});
