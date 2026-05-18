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
};
