import type { D1Database, R2Bucket, KVNamespace } from '@cloudflare/workers-types';

export type Env = {
	DB: D1Database;
	DTXFILE_BUCKET: R2Bucket;
	RATE_LIMIT_API: KVNamespace;
	SUPABASE_URL: string;
	SUPABASE_ANON_KEY: string;
	RATE_LIMIT_ENV: 'prod' | 'pre-prod' | 'pre-prod-prod-data';
	GRAPHIQL: 'true' | 'false';
	CORS_ALLOWED_ORIGINS: string;
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' | 'false';

	// Phase 2 — var (committed to wrangler.jsonc)
	PUBLIC_SIMFILE_BUCKET_URL: string;

	// Phase 2 — secrets (set via `wrangler secret put` per env)
	SUPABASE_SERVICE_ROLE_KEY: string;
	CLOUDFLARE_ZONE_ID?: string;
	CLOUDFLARE_API_TOKEN?: string;
};
