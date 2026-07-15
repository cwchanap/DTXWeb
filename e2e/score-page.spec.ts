import { test, expect } from '@playwright/test';
import { DTX_API_LOCAL_PORT, CHART_B_ID } from './test-config';

test.use({ storageState: 'e2e/.auth/user.json' });

const API_URL = `http://localhost:${DTX_API_LOCAL_PORT}/graphql`;

/**
 * Extract the Supabase access token from the browser's session cookies.
 * Same helper as score-upload.spec.ts — duplicated because e2e test files are
 * self-contained (no shared helpers module).
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
		try {
			parsed = JSON.parse(atob(authCookie.value));
		} catch {
			const raw = authCookie.value.startsWith('base64-')
				? authCookie.value.slice('base64-'.length)
				: authCookie.value;
			const remapped = raw.replace(/-/g, '+').replace(/_/g, '/');
			parsed = JSON.parse(atob(remapped));
		}
	}
	if (!parsed.access_token) {
		throw new Error('Supabase auth cookie has no access_token');
	}
	return parsed.access_token;
};

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

// One best row + one recent row, matching the buildUpload() shape.
const SCORE_PAYLOAD = (chartId: string) => ({
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

test.describe('Score page UI (/app/score)', () => {
	test.describe.configure({ retries: 0 });

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
		}>(page, token, uploadMutation, { input: SCORE_PAYLOAD(chartId) });
		expect(uploadData.uploadScores.updatedCharts).toBe(1);
		expect(uploadData.uploadScores.skipped).toEqual([]);

		// 3. Navigate to the /app/score page and verify the UI renders the
		//    uploaded scores — not just a GraphQL round-trip, but the actual
		//    rendered ScoreCard with the song title, chart label, best score,
		//    and recent play.
		await page.goto('/app/score');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');

		// The page heading is always present.
		await expect(page.getByRole('heading', { name: 'score.my_scores' })).toBeVisible();

		// The seeded chart title should appear in a ScoreCard.
		await expect(page.getByText('E2E Download Chart')).toBeVisible();

		// The chart label badge should render (e.g. "BASIC · score.level_short N").
		await expect(page.getByText(new RegExp(chartLabel))).toBeVisible();

		// The best score value should be visible (987,650 formatted by locale).
		// Use a flexible matcher since locale formatting varies.
		await expect(page.getByText(/987.?650/)).toBeVisible();

		// The SS rank badge should appear.
		await expect(page.getByText('SS').first()).toBeVisible();

		// The FC (full combo) badge should appear.
		await expect(page.getByText('FC')).toBeVisible();
	});

	test('loads the score page without crashing when there are scores', async ({ page }) => {
		// Smoke: navigate directly to /app/score and verify the page hydrates
		// and renders the heading. Scores may or may not exist from prior tests,
		// but the page must not crash either way.
		await page.goto('/app/score');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		await expect(page.getByRole('heading', { name: 'score.my_scores' })).toBeVisible();
	});
});
