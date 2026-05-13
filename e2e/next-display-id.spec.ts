import { test, expect } from '@playwright/test';
import { BASE_URL } from './constants';

test.describe('GET /api/chart/next-display-id', () => {
	test('returns 401 with JSON error when unauthenticated', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/chart/next-display-id`);

		expect(response.status()).toBe(401);
		expect(response.headers()['content-type']).toContain('application/json');

		const body = await response.json();
		expect(body).toEqual({ error: 'Unauthorized' });
	});
});
