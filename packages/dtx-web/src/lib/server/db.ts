import type { D1Database } from '@cloudflare/workers-types';
import { createMockD1Database } from '@dtx/common/server';

/** Get the D1 database binding from the SvelteKit platform env. Falls back to a mock when no platform is present (local dev). */
export const getDb = (platform: App.Platform | undefined): D1Database => {
	if (platform === undefined || platform.env === undefined) {
		return createMockD1Database();
	}
	const db = platform.env.DB;
	if (!db) {
		throw new Error(
			'D1 database binding (DB) is missing from the runtime environment. ' +
				'Verify the DB binding is configured in wrangler.jsonc and the deployment environment.'
		);
	}
	return db;
};
