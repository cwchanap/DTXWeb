// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '@dtx/common'; // import shared types
import { R2Bucket } from '@cloudflare/workers-types';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			supabase: SupabaseClient<Database>;
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			session: Session | null;
			user: User | null;
		}
		interface PageData {
			session: Session | null;
		}
		// interface PageState {}
		interface Platform {
			env?: {
				DTXFILE_BUCKET: R2Bucket;
			};
		}
	}
}
declare namespace svelte.JSX {
	interface SvelteInputProps {
		webkitdirectory?: boolean;
	}
}

export {};
