import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DTX_API_LOCAL_PORT, TEST_USER_ID } from './test-config';

test.use({ storageState: '.auth/user.json' });

const API_URL = `http://localhost:${DTX_API_LOCAL_PORT}/api/auth`;
const DEVICE_CLIENT_ID = 'dtx-desktop';
const WEB_ORIGIN = 'http://localhost:5173';

type DeviceCode = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
	interval: number;
};

type DeviceToken = {
	access_token?: string;
	error?: string;
};

const requestDeviceCode = async (page: Page): Promise<DeviceCode> => {
	const codeResponse = await page.request.post(`${API_URL}/device/code`, {
		headers: { Origin: WEB_ORIGIN },
		data: { client_id: DEVICE_CLIENT_ID }
	});
	if (!codeResponse.ok()) {
		throw new Error(
			`Device code request failed: ${codeResponse.status()} ${await codeResponse.text()}`
		);
	}
	return (await codeResponse.json()) as DeviceCode;
};

const authorizeDeviceCodeInBrowser = async (
	page: Page,
	device: DeviceCode,
	decision: 'approve' | 'deny'
): Promise<void> => {
	await page.goto(device.verification_uri_complete);
	await expect(page.getByRole('heading', { name: 'Desktop authorization' })).toBeVisible();
	await expect(page.locator('#authorization-code')).toHaveValue(device.user_code);
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(
		page.getByRole('heading', { name: 'Desktop authorization request' })
	).toBeVisible();
	await page.getByRole('button', { name: decision === 'approve' ? 'Approve' : 'Deny' }).click();
	await expect(page.getByRole('status')).toContainText(
		decision === 'approve' ? 'Desktop access approved.' : 'Desktop access denied.'
	);
};

const pollDeviceCode = async (
	request: APIRequestContext,
	deviceCode: string
): Promise<{ response: Awaited<ReturnType<APIRequestContext['post']>>; body: DeviceToken }> => {
	const response = await request.post(`${API_URL}/device/token`, {
		headers: { Origin: WEB_ORIGIN },
		data: {
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: deviceCode,
			client_id: DEVICE_CLIENT_ID
		}
	});
	return { response, body: (await response.json()) as DeviceToken };
};

test.describe('local Better Auth Device Authorization', () => {
	test.describe.configure({ mode: 'serial', retries: 0 });

	test('approves, polls, validates, and revokes a real device session', async ({
		browser,
		page
	}) => {
		await page.goto('/app');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		const device = await requestDeviceCode(page);
		expect(device.verification_uri).toBe('http://localhost:5173/app/desktop-auth');
		expect(device.verification_uri_complete).toContain(
			`http://localhost:5173/app/desktop-auth?user_code=${device.user_code}`
		);

		await authorizeDeviceCodeInBrowser(page, device, 'approve');

		const anonymousContext = await browser.newContext({
			storageState: { cookies: [], origins: [] }
		});
		try {
			const { response, body } = await pollDeviceCode(
				anonymousContext.request,
				device.device_code
			);
			expect(response.ok()).toBe(true);
			expect(body.access_token).toEqual(expect.any(String));

			const sessionResponse = await anonymousContext.request.get(`${API_URL}/get-session`, {
				headers: { Authorization: `Bearer ${body.access_token}` }
			});
			expect(sessionResponse.ok()).toBe(true);
			expect((await sessionResponse.json()).user.id).toBe(TEST_USER_ID);

			const revokeResponse = await anonymousContext.request.post(`${API_URL}/sign-out`, {
				headers: {
					Authorization: `Bearer ${body.access_token}`,
					Origin: WEB_ORIGIN
				},
				data: {}
			});
			if (!revokeResponse.ok()) {
				throw new Error(
					`Device session revoke failed: ${revokeResponse.status()} ${await revokeResponse.text()}`
				);
			}

			const revokedSessionResponse = await anonymousContext.request.get(
				`${API_URL}/get-session`,
				{
					headers: { Authorization: `Bearer ${body.access_token}` }
				}
			);
			expect(await revokedSessionResponse.json()).toBeNull();
		} finally {
			await anonymousContext.close();
		}
	});

	test('denies a claimed device authorization', async ({ browser, page }) => {
		const device = await requestDeviceCode(page);
		await authorizeDeviceCodeInBrowser(page, device, 'deny');

		const anonymousContext = await browser.newContext({
			storageState: { cookies: [], origins: [] }
		});
		try {
			const { response, body } = await pollDeviceCode(
				anonymousContext.request,
				device.device_code
			);
			expect(response.status()).toBe(400);
			expect(body.error).toBe('access_denied');
		} finally {
			await anonymousContext.close();
		}
	});

	test('expires an unapproved local device authorization code', async ({ browser, page }) => {
		const device = await requestDeviceCode(page);
		const anonymousContext = await browser.newContext({
			storageState: { cookies: [], origins: [] }
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, device.expires_in * 1_000 + 500));
			const { response, body } = await pollDeviceCode(
				anonymousContext.request,
				device.device_code
			);

			expect(response.status()).toBe(400);
			expect(body.error).toBe('expired_token');
		} finally {
			await anonymousContext.close();
		}
	});
});
