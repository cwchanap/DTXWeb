import type { D1Database, R2Bucket, KVNamespace, Workflow } from '@cloudflare/workers-types';
import type { GenerateBgmM4aPayload } from './services/bgmM4a';

export type Env = {
	DB: D1Database;
	DTXFILE_BUCKET: R2Bucket;
	RATE_LIMIT_API: KVNamespace;
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_DEVICE_CODE_EXPIRES_IN?: string;
	DTX_WEB_URL: string;
	AUTH_COOKIE_DOMAIN?: string;
	AUTH_COOKIE_PREFIX: string;
	GOOGLE_AUTH_CLIENT_ID: string;
	GOOGLE_AUTH_CLIENT_SECRET: string;
	RATE_LIMIT_ENV: 'prod' | 'pre-prod' | 'pre-prod-prod-data';
	GRAPHIQL: 'true' | 'false';
	CORS_ALLOWED_ORIGINS: string;
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' | 'false';
	BGM_M4A_GENERATION_ENABLED?: 'true' | 'false';
	BGM_M4A_WORKFLOW?: Workflow<GenerateBgmM4aPayload>;
	BGM_TRANSCODER?: DurableObjectNamespace;

	// Phase 2 — var (committed to wrangler.jsonc)
	PUBLIC_SIMFILE_BUCKET_URL: string;

	// Phase 2 — secrets (set via `wrangler secret put` per env)
	CLOUDFLARE_ZONE_ID?: string;
	CLOUDFLARE_API_TOKEN?: string;
	MAX_UPLOADS_PER_HOUR?: string;
};
