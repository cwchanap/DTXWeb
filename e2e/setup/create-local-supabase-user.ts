import { TEST_USER_EMAIL, TEST_USER_ID, TEST_USER_PASSWORD } from '../test-config';

const requireEnv = (name: string): string => {
	const value = process.env[name];
	if (!value) {
		throw new Error(`[create-local-supabase-user] ${name} is required`);
	}
	return value;
};

const supabaseUrl = requireEnv('E2E_SUPABASE_URL');
const serviceRoleKey = requireEnv('E2E_SUPABASE_SERVICE_ROLE_KEY');

const createUser = async (): Promise<void> => {
	const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
		method: 'POST',
		headers: {
			apikey: serviceRoleKey,
			Authorization: `Bearer ${serviceRoleKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			id: TEST_USER_ID,
			email: TEST_USER_EMAIL,
			password: TEST_USER_PASSWORD,
			email_confirm: true
		})
	});

	if (response.ok) {
		return;
	}

	const body = await response.text();
	throw new Error(`[create-local-supabase-user] failed (${response.status}): ${body}`);
};

await createUser();
