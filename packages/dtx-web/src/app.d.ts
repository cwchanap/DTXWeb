// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces

import type { Fetcher } from '@cloudflare/workers-types';

import type { AuthSession, AuthUser } from '$lib/auth/session';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			session: AuthSession | null;
			user: AuthUser | null;
		}
		interface PageData {
			session: AuthSession | null;
			user: AuthUser | null;
		}
		// interface PageState {}
		interface Platform {
			env?: {
				API?: Fetcher;
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
