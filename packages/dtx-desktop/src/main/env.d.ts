/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly PUBLIC_SUPABASE_URL: string;
	readonly PUBLIC_SUPABASE_ANON_KEY: string;
	readonly PUBLIC_CLOUDFLARE_R2_PUBLIC_URL: string;
	readonly PUBLIC_SIMFILE_BUCKET_URL: string;
	readonly PUBLIC_SKIN_BUCKET_URL: string;
	readonly PUBLIC_CLOUDFARE_WORKER_URL: string;
	readonly VITE_DTX_SERVER_URL: string;
	// more env variables...
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
