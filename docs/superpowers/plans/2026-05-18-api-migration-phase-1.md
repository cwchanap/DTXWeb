# API Migration Phase 1 — Scaffold `packages/dtx-api` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new Cloudflare Worker package `packages/dtx-api` with GraphQL Yoga + Pothos, Supabase bearer auth, CORS, and a `/healthz` REST endpoint. Deploy it to `api.pre-prod.dtx.hapadona.com`. No changes to `dtx-web` / `dtx-desktop`; prod deploy is deferred to Phase 5.

**Architecture:** A standalone Workers package (no Vite, no SvelteKit). Wrangler bundles `src/index.ts` directly. GraphQL via Yoga (`graphql-yoga`) with a Pothos code-first schema (`@pothos/core` + `scope-auth` + `errors` plugins). Auth is a pure function `verifyToken(request, env)` ported from `dtx-web`'s `hooks.server.ts`. CORS is a small middleware reading a comma-separated env var. A new `workerLogger` is added to `@dtx/common/server` so the Worker doesn't pull in winston.

**Tech Stack:** TypeScript 5.x, Bun workspaces, Wrangler 4.x, GraphQL Yoga 5.x, Pothos 4.x, `@supabase/supabase-js`, `@cloudflare/workers-types`, Vitest. Common package built via `svelte-package` (existing).

**Spec:** `docs/superpowers/specs/2026-05-18-api-migration-phase-1-design.md`.

---

## File Structure (end state)

```text
packages/common/
└── src/lib/
    ├── server.ts                            ← extend: re-export workerLogger
    └── server/
        ├── workerLogger.ts                  ← NEW
        └── workerLogger.test.ts             ← NEW

packages/dtx-api/                            ← NEW package
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── wrangler.jsonc
├── README.md
└── src/
    ├── index.ts                             Worker entry
    ├── env.ts                               Env type
    ├── context.ts                           GraphQL context + createContext
    ├── auth/
    │   ├── verifyToken.ts
    │   └── verifyToken.test.ts
    ├── lib/
    │   ├── cors.ts
    │   └── cors.test.ts
    ├── rest/
    │   ├── healthz.ts
    │   └── healthz.test.ts
    └── schema/
        ├── builder.ts                       Pothos builder + plugins
        ├── healthz.ts                       Query.healthz field
        ├── index.ts                         schema + yoga exports
        └── schema.test.ts

/package.json                                ← extend: 3 scripts + 1 workspace entry
```

---

## Task 1: Add `workerLogger` to `@dtx/common/server`

**Files:**

- Create: `packages/common/src/lib/server/workerLogger.ts`
- Create: `packages/common/src/lib/server/workerLogger.test.ts`
- Modify: `packages/common/src/lib/server.ts`

`dtx-api` must not pull in winston. Add a Workers-safe logger that emits JSON to `console`. The existing winston `logger` export stays untouched so `dtx-web` is unaffected.

- [ ] **Step 1: Write the failing test**

Create `packages/common/src/lib/server/workerLogger.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workerLogger } from './workerLogger';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('workerLogger', () => {
	it('info emits one JSON line to console.log with level/msg/timestamp', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		workerLogger.info('hello');
		expect(spy).toHaveBeenCalledOnce();
		const payload = JSON.parse(spy.mock.calls[0][0] as string);
		expect(payload).toMatchObject({ level: 'info', msg: 'hello' });
		expect(typeof payload.ts).toBe('string');
		expect(new Date(payload.ts).toString()).not.toBe('Invalid Date');
	});

	it('merges meta keys into the JSON payload', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		workerLogger.info('user signed in', { userId: 'abc', ip: '1.2.3.4' });
		const payload = JSON.parse(spy.mock.calls[0][0] as string);
		expect(payload).toMatchObject({
			level: 'info',
			msg: 'user signed in',
			userId: 'abc',
			ip: '1.2.3.4'
		});
	});

	it('warn/error/debug route to their respective console methods', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

		workerLogger.warn('w');
		workerLogger.error('e');
		workerLogger.debug('d');

		expect(JSON.parse(warn.mock.calls[0][0] as string).level).toBe('warn');
		expect(JSON.parse(error.mock.calls[0][0] as string).level).toBe('error');
		expect(JSON.parse(debug.mock.calls[0][0] as string).level).toBe('debug');
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=@dtx/common test -- workerLogger`
Expected: FAIL with "Cannot find module './workerLogger'" (or similar).

- [ ] **Step 3: Implement `workerLogger`**

Create `packages/common/src/lib/server/workerLogger.ts`:

```ts
type Meta = Record<string, unknown>;

const format = (level: string, msg: string, meta?: Meta): string =>
	JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta ?? {}) });

export const workerLogger = {
	info: (msg: string, meta?: Meta) => console.log(format('info', msg, meta)),
	warn: (msg: string, meta?: Meta) => console.warn(format('warn', msg, meta)),
	error: (msg: string, meta?: Meta) => console.error(format('error', msg, meta)),
	debug: (msg: string, meta?: Meta) => console.debug(format('debug', msg, meta))
};

export type WorkerLogger = typeof workerLogger;
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=@dtx/common test -- workerLogger`
Expected: PASS, 3 tests green.

- [ ] **Step 5: Add re-export to `@dtx/common`'s server entry**

Open `packages/common/src/lib/server.ts`. At the bottom of the file, append:

```ts
// Workers-safe logger (use this from any code running in a Cloudflare Worker)
export { workerLogger, type WorkerLogger } from './server/workerLogger';
```

- [ ] **Step 6: Verify common package builds and all tests pass**

Run: `bun run --filter=@dtx/common check`
Expected: 0 errors.

Run: `bun run --filter=@dtx/common test`
Expected: all tests pass (workerLogger + existing).

- [ ] **Step 7: Build `@dtx/common` so its `dist/` includes the new export**

Run: `bun run --filter=@dtx/common build`
Expected: build succeeds. `dist/server.js` and `dist/server.d.ts` updated.

Verify the new export is in the declaration file:

```bash
grep -E "workerLogger" packages/common/dist/server.d.ts
```

Expected: at least one match for `workerLogger`.

- [ ] **Step 8: Commit**

```bash
git add packages/common/src/lib/server.ts packages/common/src/lib/server/workerLogger.ts packages/common/src/lib/server/workerLogger.test.ts
git commit -m "feat(common): add workerLogger for Cloudflare Workers

Lightweight JSON-formatted console logger for code running in a
Worker isolate. Avoids bundling winston (Node-heavy) into the
upcoming dtx-api Worker. Existing winston \`logger\` export stays
untouched. Phase 1 of the API server migration."
```

---

## Task 2: Scaffold `packages/dtx-api` package metadata

**Files:**

- Create: `packages/dtx-api/package.json`
- Create: `packages/dtx-api/tsconfig.json`
- Create: `packages/dtx-api/vitest.config.ts`
- Create: `packages/dtx-api/README.md`
- Modify: `/package.json` (add workspace entry)

This task creates the empty package shell. No source code yet — that comes in subsequent tasks. Verify `bun install` accepts the workspace and `tsc --noEmit` runs cleanly against the empty src tree.

- [ ] **Step 1: Create the package directory tree**

Run: `mkdir -p packages/dtx-api/src/auth packages/dtx-api/src/lib packages/dtx-api/src/rest packages/dtx-api/src/schema`

- [ ] **Step 2: Write `packages/dtx-api/package.json`**

```jsonc
{
	"name": "dtx-api",
	"version": "0.0.1",
	"private": true,
	"type": "module",
	"scripts": {
		"dev": "wrangler dev",
		"build": "wrangler deploy --dry-run --outdir=dist",
		"deploy:prod": "wrangler deploy",
		"deploy:preprod": "wrangler deploy --env pre-prod",
		"deploy:preprod:prod-data": "wrangler deploy --env pre-prod-prod-data",
		"test": "vitest --run",
		"test:watch": "vitest",
		"check": "tsc --noEmit",
		"cf-typegen": "wrangler types --env-interface CloudflareBindings"
	},
	"dependencies": {
		"@dtx/common": "*",
		"@pothos/core": "^4.0.0",
		"@pothos/plugin-errors": "^4.0.0",
		"@pothos/plugin-scope-auth": "^4.0.0",
		"@supabase/supabase-js": "^2.49.4",
		"graphql": "^16.10.0",
		"graphql-yoga": "^5.10.0"
	},
	"devDependencies": {
		"@cloudflare/workers-types": "^4.20250620.0",
		"@vitest/coverage-v8": "^3.0.0",
		"typescript": "^5.8.3",
		"vitest": "^3.1.4",
		"wrangler": "^4.0.0"
	}
}
```

- [ ] **Step 3: Write `packages/dtx-api/tsconfig.json`**

```jsonc
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"target": "ES2022",
		"module": "ES2022",
		"moduleResolution": "Bundler",
		"lib": ["ES2022"],
		"types": ["@cloudflare/workers-types"],
		"noEmit": true,
		"isolatedModules": true,
		"verbatimModuleSyntax": false,
		"allowSyntheticDefaultImports": true
	},
	"include": ["src/**/*.ts"],
	"exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 4: Write `packages/dtx-api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		globals: false,
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['**/*.test.ts', 'src/index.ts']
		}
	}
});
```

`@dtx/common` resolves through the workspace's `dist/` (built in Task 1, Step 7); no alias is required.

- [ ] **Step 5: Write `packages/dtx-api/README.md`**

```markdown
# dtx-api

Cloudflare Worker that hosts the project's GraphQL API at `api.dtx.hapadona.com`.

- `POST /graphql` — Yoga + Pothos schema
- `GET /graphql` — GraphiQL playground (pre-prod only, `GRAPHIQL=true`)
- `GET /healthz` — liveness probe

See `docs/superpowers/specs/2026-05-16-api-server-migration-design.md` for the parent design.
```

- [ ] **Step 6: Add the package to root workspaces**

Open `/package.json` and find:

```jsonc
	"workspaces": [
		"packages/dtx-web",
		"packages/dtx-desktop",
		"packages/common",
		"packages/ui-components"
	],
```

Replace with:

```jsonc
	"workspaces": [
		"packages/dtx-web",
		"packages/dtx-desktop",
		"packages/common",
		"packages/ui-components",
		"packages/dtx-api"
	],
```

- [ ] **Step 7: Install dependencies**

Run: `bun install`
Expected: installs successfully; `packages/dtx-api/node_modules` populated; `bun.lock` updated.

- [ ] **Step 8: Verify the empty type-check passes**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors (no `.ts` files to check yet; tsc exits cleanly).

- [ ] **Step 9: Verify the empty test run passes**

Run: `bun run --filter=dtx-api test`
Expected: vitest reports "No test files found" and exits with a non-zero code.

Add `--passWithNoTests` to the test script for now so the scaffold task is clean. Open `packages/dtx-api/package.json` and change:

```jsonc
		"test": "vitest --run",
```

to:

```jsonc
		"test": "vitest --run --passWithNoTests",
```

Re-run: `bun run --filter=dtx-api test`
Expected: PASS (no tests).

- [ ] **Step 10: Commit**

```bash
git add package.json bun.lock packages/dtx-api/
git commit -m "chore(dtx-api): scaffold empty package

New Bun workspace for the GraphQL API Worker. Adds package
metadata, tsconfig, vitest config, README, and registers the
package. No source code yet — follow-up tasks add it. Phase 1
of the API server migration."
```

---

## Task 3: Define `Env` type

**Files:**

- Create: `packages/dtx-api/src/env.ts`

The `Env` interface is the typed shape of the bindings + vars in `wrangler.jsonc`. Everything that touches `env` references this type, so it lands first. No tests — it's a pure type declaration.

- [ ] **Step 1: Write `packages/dtx-api/src/env.ts`**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-api/src/env.ts
git commit -m "feat(dtx-api): add Env type for Worker bindings + vars"
```

---

## Task 4: Auth middleware — `verifyToken`

**Files:**

- Create: `packages/dtx-api/src/auth/verifyToken.ts`
- Create: `packages/dtx-api/src/auth/verifyToken.test.ts`

Ports the bearer-token verification path from `packages/dtx-web/src/hooks.server.ts` into a pure function. Bearer-only — no cookies, no CSRF, no desktop user-agent sniffing. The mock pattern mirrors `packages/dtx-web/src/hooks.server.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/dtx-api/src/auth/verifyToken.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => {
	const getUser = vi.fn();
	return {
		createClient: vi.fn(() => ({ auth: { getUser } })),
		__getUser: getUser
	};
});

let verifyToken: typeof import('./verifyToken').verifyToken;
let getUser: ReturnType<typeof vi.fn>;

beforeEach(async () => {
	vi.resetModules();
	const mod = await import('@supabase/supabase-js');
	getUser = (mod as unknown as { __getUser: ReturnType<typeof vi.fn> }).__getUser;
	getUser.mockReset();
	({ verifyToken } = await import('./verifyToken'));
});

const env: Env = {
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon-key',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'true',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false'
};

const makeJwt = (payload: Record<string, unknown>): string => {
	const b64url = (obj: unknown): string =>
		btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
	return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
};

const reqWith = (headers: Record<string, string>): Request =>
	new Request('https://api.test/anything', { headers });

describe('verifyToken', () => {
	it('returns null when Authorization header is absent', async () => {
		expect(await verifyToken(reqWith({}), env)).toBeNull();
	});

	it('returns null when Authorization is not a Bearer token', async () => {
		expect(await verifyToken(reqWith({ authorization: 'Basic abc' }), env)).toBeNull();
	});

	it('returns null when Bearer token is empty after the prefix', async () => {
		expect(await verifyToken(reqWith({ authorization: 'Bearer   ' }), env)).toBeNull();
	});

	it('returns null when supabase.auth.getUser rejects', async () => {
		getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad token' } });
		const token = makeJwt({ exp: 9999999999 });
		const result = await verifyToken(reqWith({ authorization: `Bearer ${token}` }), env);
		expect(result).toBeNull();
	});

	it('returns user + synthetic session when supabase accepts a valid token', async () => {
		const user = { id: 'user-1', email: 'a@b.com' };
		getUser.mockResolvedValue({ data: { user }, error: null });
		const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

		const result = await verifyToken(reqWith({ authorization: `Bearer ${token}` }), env);

		expect(result).not.toBeNull();
		expect(result!.user).toEqual(user);
		expect(result!.session.access_token).toBe(token);
		expect(result!.session.token_type).toBe('bearer');
		expect(result!.session.refresh_token).toBe('');
		expect(result!.session.expires_in).toBeGreaterThan(0);
		expect(result!.session.expires_in).toBeLessThanOrEqual(3600);
	});

	it('clamps expires_in to 0 when exp is in the past (parity with hooks.server.ts)', async () => {
		const user = { id: 'user-1', email: 'a@b.com' };
		getUser.mockResolvedValue({ data: { user }, error: null });
		const token = makeJwt({ exp: 1 });

		const result = await verifyToken(reqWith({ authorization: `Bearer ${token}` }), env);

		expect(result).not.toBeNull();
		expect(result!.session.expires_in).toBe(0);
	});

	it('returns null when JWT payload is undecodable', async () => {
		const user = { id: 'user-1', email: 'a@b.com' };
		getUser.mockResolvedValue({ data: { user }, error: null });
		const result = await verifyToken(reqWith({ authorization: 'Bearer not.a.valid.jwt' }), env);
		expect(result).toBeNull();
	});

	it('accepts case-insensitive Bearer prefix', async () => {
		const user = { id: 'user-1', email: 'a@b.com' };
		getUser.mockResolvedValue({ data: { user }, error: null });
		const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
		const result = await verifyToken(reqWith({ authorization: `bearer ${token}` }), env);
		expect(result).not.toBeNull();
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- verifyToken`
Expected: FAIL with "Cannot find module './verifyToken'".

- [ ] **Step 3: Implement `verifyToken`**

Create `packages/dtx-api/src/auth/verifyToken.ts`:

```ts
import { createClient, type Session, type User } from '@supabase/supabase-js';
import type { Env } from '../env';

const decodeJwtPayload = (token: string): { exp?: number } | null => {
	try {
		const base64Url = token.split('.')[1];
		if (!base64Url) return null;
		let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		while (base64.length % 4 !== 0) base64 += '=';
		return JSON.parse(atob(base64));
	} catch {
		return null;
	}
};

export const verifyToken = async (
	request: Request,
	env: Env
): Promise<{ user: User; session: Session } | null> => {
	const authHeader = request.headers.get('Authorization') ?? request.headers.get('authorization');
	if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
		return null;
	}
	const token = authHeader.slice(7).trim();
	if (!token) return null;

	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
	});

	const { data, error } = await supabase.auth.getUser(token);
	if (error || !data.user) return null;

	const payload = decodeJwtPayload(token);
	if (!payload) return null;

	const nowSeconds = Math.floor(Date.now() / 1000);
	const expiresIn = Math.max(0, payload.exp ? payload.exp - nowSeconds : 3600);
	const expiresAt = nowSeconds + expiresIn;

	const session: Session = {
		access_token: token,
		refresh_token: '',
		expires_in: expiresIn,
		expires_at: expiresAt,
		token_type: 'bearer',
		user: data.user
	};

	return { user: data.user, session };
};
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- verifyToken`
Expected: PASS, 8 tests green.

- [ ] **Step 5: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/src/auth/
git commit -m "feat(dtx-api): add bearer-token verifyToken middleware

Pure function port of the bearer auth branch from dtx-web's
hooks.server.ts. Returns { user, session } or null; downstream
context builder + GraphQL resolvers decide whether anonymous
is acceptable. Phase 1 of the API server migration."
```

---

## Task 5: CORS middleware

**Files:**

- Create: `packages/dtx-api/src/lib/cors.ts`
- Create: `packages/dtx-api/src/lib/cors.test.ts`

Strict allow-list driven by the comma-separated `CORS_ALLOWED_ORIGINS` env var. Origin missing → no CORS headers, request passes through (covers Electron desktop, curl, server-to-server). Origin foreign → no ACAO (browser blocks naturally; no 403 leakage).

- [ ] **Step 1: Write the failing test**

Create `packages/dtx-api/src/lib/cors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handlePreflight, withCors } from './cors';
import type { Env } from '../env';

const makeEnv = (origins: string): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'true',
	CORS_ALLOWED_ORIGINS: origins,
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false'
});

describe('handlePreflight', () => {
	it('returns null for non-OPTIONS requests', () => {
		const result = handlePreflight(
			new Request('https://api.test/', { method: 'GET' }),
			makeEnv('https://x.com')
		);
		expect(result).toBeNull();
	});

	it('returns 204 with ACAO + Vary when Origin is allow-listed', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com,http://localhost:5173');
		const result = handlePreflight(
			new Request('https://api.test/', {
				method: 'OPTIONS',
				headers: { Origin: 'http://localhost:5173' }
			}),
			env
		)!;
		expect(result.status).toBe(204);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		expect(result.headers.get('Vary')).toBe('Origin');
		expect(result.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
		expect(result.headers.get('Access-Control-Allow-Headers')).toBe(
			'authorization, content-type, x-requested-with'
		);
		expect(result.headers.get('Access-Control-Max-Age')).toBe('86400');
	});

	it('returns 204 without ACAO when Origin is foreign', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const result = handlePreflight(
			new Request('https://api.test/', {
				method: 'OPTIONS',
				headers: { Origin: 'https://evil.example.com' }
			}),
			env
		)!;
		expect(result.status).toBe(204);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('returns 204 without ACAO when Origin header is missing', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const result = handlePreflight(
			new Request('https://api.test/', { method: 'OPTIONS' }),
			env
		)!;
		expect(result.status).toBe(204);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('parses CORS_ALLOWED_ORIGINS with whitespace and empty entries', () => {
		const env = makeEnv('  https://a.com  ,, http://b.com  ');
		const result = handlePreflight(
			new Request('https://api.test/', {
				method: 'OPTIONS',
				headers: { Origin: 'http://b.com' }
			}),
			env
		)!;
		expect(result.headers.get('Access-Control-Allow-Origin')).toBe('http://b.com');
	});
});

describe('withCors', () => {
	it('returns response unchanged when Origin is absent', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const response = new Response('hi', { status: 200 });
		const result = withCors(response, new Request('https://api.test/'), env);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('returns response unchanged when Origin is foreign', () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const response = new Response('hi', { status: 200 });
		const result = withCors(
			response,
			new Request('https://api.test/', { headers: { Origin: 'https://evil.example.com' } }),
			env
		);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('attaches ACAO+Vary when Origin is allow-listed and preserves status + headers', async () => {
		const env = makeEnv('https://pre-prod.dtx.hapadona.com');
		const response = new Response('hi', { status: 201, headers: { 'X-Test': '1' } });
		const result = withCors(
			response,
			new Request('https://api.test/', {
				headers: { Origin: 'https://pre-prod.dtx.hapadona.com' }
			}),
			env
		);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBe(
			'https://pre-prod.dtx.hapadona.com'
		);
		expect(result.headers.get('Vary')).toBe('Origin');
		expect(result.headers.get('X-Test')).toBe('1');
		expect(result.status).toBe(201);
		expect(await result.text()).toBe('hi');
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- cors`
Expected: FAIL with "Cannot find module './cors'".

- [ ] **Step 3: Implement CORS**

Create `packages/dtx-api/src/lib/cors.ts`:

```ts
import type { Env } from '../env';

const cache = new Map<string, Set<string>>();

const getAllowedOrigins = (env: Env): Set<string> => {
	const raw = env.CORS_ALLOWED_ORIGINS;
	let set = cache.get(raw);
	if (!set) {
		set = new Set(
			raw
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		);
		cache.set(raw, set);
	}
	return set;
};

const baseHeaders = (): Record<string, string> => ({
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'authorization, content-type, x-requested-with',
	'Access-Control-Max-Age': '86400'
});

export const handlePreflight = (request: Request, env: Env): Response | null => {
	if (request.method !== 'OPTIONS') return null;

	const origin = request.headers.get('Origin');
	const headers: Record<string, string> = baseHeaders();

	if (origin && getAllowedOrigins(env).has(origin)) {
		headers['Access-Control-Allow-Origin'] = origin;
		headers['Vary'] = 'Origin';
		headers['Access-Control-Allow-Credentials'] = 'false';
	}

	return new Response(null, { status: 204, headers });
};

export const withCors = (response: Response, request: Request, env: Env): Response => {
	const origin = request.headers.get('Origin');
	if (!origin) return response;
	if (!getAllowedOrigins(env).has(origin)) return response;

	const headers = new Headers(response.headers);
	headers.set('Access-Control-Allow-Origin', origin);
	headers.set('Vary', 'Origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- cors`
Expected: PASS, 8 tests green.

- [ ] **Step 5: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/src/lib/
git commit -m "feat(dtx-api): add CORS middleware

Allow-list driven by CORS_ALLOWED_ORIGINS env var (comma-separated).
Missing/foreign origins receive no ACAO header. Preflight handler
short-circuits OPTIONS requests. Phase 1 of the API server migration."
```

---

## Task 6: REST `/healthz` endpoint

**Files:**

- Create: `packages/dtx-api/src/rest/healthz.ts`
- Create: `packages/dtx-api/src/rest/healthz.test.ts`

Liveness probe. Returns a JSON envelope with build metadata. Does NOT touch D1/R2/KV — uptime monitors shouldn't burn quota or false-positive on transient binding latency.

- [ ] **Step 1: Write the failing test**

Create `packages/dtx-api/src/rest/healthz.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { healthz } from './healthz';
import type { Env } from '../env';

const env: Env = {
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'true',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false'
};

describe('healthz', () => {
	it('returns 200 with application/json content-type', () => {
		const response = healthz(new Request('https://api.test/healthz'), env);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
	});

	it('body includes ok=true, service, version, buildSha', async () => {
		const response = healthz(new Request('https://api.test/healthz'), env);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ ok: true, service: 'dtx-api' });
		expect(typeof body.version).toBe('string');
		expect(typeof body.buildSha).toBe('string');
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- healthz`
Expected: FAIL with "Cannot find module './healthz'".

- [ ] **Step 3: Implement `/healthz`**

Create `packages/dtx-api/src/rest/healthz.ts`:

```ts
import type { Env } from '../env';

declare const __BUILD_SHA__: string | undefined;

export const healthz = (_request: Request, _env: Env): Response =>
	new Response(
		JSON.stringify({
			ok: true,
			service: 'dtx-api',
			version: '0.0.1',
			buildSha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- healthz`
Expected: PASS, 2 tests green.

- [ ] **Step 5: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/src/rest/
git commit -m "feat(dtx-api): add /healthz REST liveness endpoint

Returns JSON {ok, service, version, buildSha}. Does not probe
D1/R2/KV — liveness only. Phase 1 of the API server migration."
```

---

## Task 7: GraphQL — Pothos builder, `Query.healthz`, Yoga server

**Files:**

- Create: `packages/dtx-api/src/context.ts`
- Create: `packages/dtx-api/src/schema/builder.ts`
- Create: `packages/dtx-api/src/schema/healthz.ts`
- Create: `packages/dtx-api/src/schema/index.ts`
- Create: `packages/dtx-api/src/schema/schema.test.ts`

This task sets up the GraphQL pipeline end-to-end. The test drives `yoga.fetch('/graphql', …)` directly, covering schema execution + GraphiQL gating.

Pothos v4 scope-auth plugin syntax: register the plugin in `plugins`, declare typed scopes via the second type param, and provide `authScopes` as a (context-aware) function. If `bun install` resolved a Pothos minor that doesn't match the snippets below, consult `https://pothos-graphql.dev/docs/plugins/scope-auth` and adjust the import / option names; the test contract (which fields exist on the schema) is what gates correctness.

- [ ] **Step 1: Write `context.ts`**

Create `packages/dtx-api/src/context.ts`:

```ts
import type { Session, User } from '@supabase/supabase-js';
import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import { workerLogger, type WorkerLogger } from '@dtx/common/server';
import { verifyToken } from './auth/verifyToken';
import type { Env } from './env';

export type Ctx = {
	user: User | null;
	session: Session | null;
	env: Env;
	db: D1Database;
	r2: R2Bucket;
	kv: KVNamespace;
	request: Request;
	logger: WorkerLogger;
	ownerByIdCache: Map<string, string | null>;
};

export const createContext = async (request: Request, env: Env): Promise<Ctx> => {
	const auth = await verifyToken(request, env);
	return {
		user: auth?.user ?? null,
		session: auth?.session ?? null,
		env,
		db: env.DB,
		r2: env.DTXFILE_BUCKET,
		kv: env.RATE_LIMIT_API,
		request,
		logger: workerLogger,
		ownerByIdCache: new Map()
	};
};
```

- [ ] **Step 2: Write `schema/builder.ts`**

Create `packages/dtx-api/src/schema/builder.ts`:

```ts
import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ErrorsPlugin from '@pothos/plugin-errors';
import type { Ctx } from '../context';

export const builder = new SchemaBuilder<{
	Context: Ctx;
	AuthScopes: {
		user: boolean;
		owner: { simfileId: string };
		publicOrOwner: { simfileId: string };
	};
}>({
	plugins: [ScopeAuthPlugin, ErrorsPlugin],
	scopeAuth: {
		authScopes: async (ctx) => ({
			user: ctx.user != null,
			// Phase 2 wires these to ctx.ownerByIdCache + getSimfileOwner; Phase 1 stubs.
			owner: async () => false,
			publicOrOwner: async () => false
		})
	}
});

builder.queryType({});
builder.mutationType({});
```

- [ ] **Step 3: Write `schema/healthz.ts`**

Create `packages/dtx-api/src/schema/healthz.ts`:

```ts
import { builder } from './builder';

builder.queryField('healthz', (t) =>
	t.string({
		resolve: () => 'ok'
	})
);
```

- [ ] **Step 4: Write `schema/index.ts`**

Create `packages/dtx-api/src/schema/index.ts`:

```ts
import { createYoga } from 'graphql-yoga';
import { builder } from './builder';
import './healthz';
import { createContext } from '../context';
import type { Env } from '../env';

export const schema = builder.toSchema();

type YogaServerContext = { env: Env; ctx: ExecutionContext };

export const yoga = createYoga<YogaServerContext>({
	schema,
	context: ({ request, env }) => createContext(request, env),
	graphiql: (_request, { env }) => env.GRAPHIQL === 'true',
	landingPage: false,
	cors: false,
	maskedErrors: true
});
```

- [ ] **Step 5: Write the failing test**

Create `packages/dtx-api/src/schema/schema.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { schema } from './index';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

const makeEnv = (graphiql: 'true' | 'false'): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: graphiql,
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false'
});

const makeTestYoga = (env: Env) =>
	createYoga<{ env: Env }>({
		schema,
		context: (): Ctx => ({
			user: null,
			session: null,
			env,
			db: env.DB,
			r2: env.DTXFILE_BUCKET,
			kv: env.RATE_LIMIT_API,
			request: new Request('http://test'),
			logger: workerLogger,
			ownerByIdCache: new Map()
		}),
		graphiql: (_req, ctx) => ctx.env.GRAPHIQL === 'true',
		cors: false,
		landingPage: false,
		maskedErrors: false
	});

describe('GraphQL schema', () => {
	it('Query.healthz resolves to "ok"', async () => {
		const env = makeEnv('false');
		const yoga = makeTestYoga(env);
		const response = await yoga.fetch(
			'http://test/graphql',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query: '{ healthz }' })
			},
			{ env }
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: { healthz: string } };
		expect(body.data.healthz).toBe('ok');
	});

	it('introspection lists Query.healthz as a field', async () => {
		const env = makeEnv('false');
		const yoga = makeTestYoga(env);
		const response = await yoga.fetch(
			'http://test/graphql',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: '{ __schema { queryType { fields { name } } } }'
				})
			},
			{ env }
		);
		const body = (await response.json()) as {
			data: { __schema: { queryType: { fields: Array<{ name: string }> } } };
		};
		expect(body.data.__schema.queryType.fields.map((f) => f.name)).toContain('healthz');
	});

	it('GET /graphql returns GraphiQL HTML when GRAPHIQL=true', async () => {
		const env = makeEnv('true');
		const yoga = makeTestYoga(env);
		const response = await yoga.fetch(
			'http://test/graphql',
			{ method: 'GET', headers: { accept: 'text/html' } },
			{ env }
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
	});

	it('GET /graphql does not return GraphiQL when GRAPHIQL=false', async () => {
		const env = makeEnv('false');
		const yoga = makeTestYoga(env);
		const response = await yoga.fetch(
			'http://test/graphql',
			{ method: 'GET', headers: { accept: 'text/html' } },
			{ env }
		);
		// Yoga returns a non-HTML body (typically a 400) when GraphiQL is disabled and the
		// request is a GET without a valid GraphQL query.
		expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
	});
});
```

- [ ] **Step 6: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- schema`
Expected: PASS, 4 tests green.

(If the Pothos v4 scope-auth plugin requires a different option name than `scopeAuth`, the import will surface a TS error or a runtime crash in this test. Inspect the error, consult the Pothos v4 changelog, and adjust the builder options. The test contract — what fields exist on the schema — does not change.)

- [ ] **Step 7: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add packages/dtx-api/src/context.ts packages/dtx-api/src/schema/
git commit -m "feat(dtx-api): scaffold GraphQL pipeline with Query.healthz

Pothos builder with scope-auth + errors plugins registered.
Yoga server constructed at module scope; per-request context
runs verifyToken + builds Ctx. GraphiQL gated on env.GRAPHIQL.
Phase 1 of the API server migration."
```

---

## Task 8: Wire the Worker entry

**Files:**

- Create: `packages/dtx-api/src/index.ts`

The router is intentionally tiny — three branches plus a 404. CORS wraps every outgoing response.

- [ ] **Step 1: Write `packages/dtx-api/src/index.ts`**

```ts
import { yoga } from './schema';
import { healthz } from './rest/healthz';
import { handlePreflight, withCors } from './lib/cors';
import type { Env } from './env';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const preflight = handlePreflight(request, env);
		if (preflight) return preflight;

		const url = new URL(request.url);

		if (url.pathname === '/healthz') {
			return withCors(healthz(request, env), request, env);
		}

		if (url.pathname === '/graphql') {
			const response = await yoga.fetch(request, env, ctx);
			return withCors(response, request, env);
		}

		return withCors(new Response('Not Found', { status: 404 }), request, env);
	}
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 3: Run the full test suite**

Run: `bun run --filter=dtx-api test`
Expected: all tests pass (verifyToken: 8, cors: 8, healthz: 2, schema: 4 = 22 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-api/src/index.ts
git commit -m "feat(dtx-api): wire Worker entry point

Routes incoming requests: OPTIONS preflight, /healthz, /graphql,
or 404. Every outgoing response is CORS-wrapped. Phase 1 of the
API server migration."
```

---

## Task 9: Wrangler configuration + root deploy scripts

**Files:**

- Create: `packages/dtx-api/wrangler.jsonc`
- Modify: `/package.json` (add `deploy:api*` scripts)

Three envs from day 1, mirroring `dtx-web`. KV namespace IDs are placeholders here; Task 10 fills real IDs after creating the namespaces.

- [ ] **Step 1: Write `packages/dtx-api/wrangler.jsonc`**

```jsonc
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "dtx-api",
	"main": "src/index.ts",
	"compatibility_date": "2025-01-01",
	"compatibility_flags": ["nodejs_compat"],
	"route": {
		"pattern": "api.dtx.hapadona.com",
		"custom_domain": true
	},
	"r2_buckets": [
		{
			"binding": "DTXFILE_BUCKET",
			"bucket_name": "simfile-dtx"
		}
	],
	"kv_namespaces": [
		{
			"binding": "RATE_LIMIT_API",
			"id": "REPLACE_WITH_PROD_KV_ID"
		}
	],
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "dtx-web",
			"database_id": "19376000-d389-4e0e-a5a8-00d9e31a9ffb"
		}
	],
	"vars": {
		"SUPABASE_URL": "REPLACE_WITH_PUBLIC_SUPABASE_URL",
		"SUPABASE_ANON_KEY": "REPLACE_WITH_PUBLIC_SUPABASE_ANON_KEY",
		"RATE_LIMIT_ENV": "prod",
		"GRAPHIQL": "false",
		"CORS_ALLOWED_ORIGINS": "https://dtx.hapadona.com",
		"PUBLIC_ENABLE_BLOG_DOWNLOAD": "false"
	},
	"keep_vars": true,
	"observability": {
		"logs": {
			"enabled": true
		}
	},
	"env": {
		"pre-prod": {
			"route": {
				"pattern": "api.pre-prod.dtx.hapadona.com",
				"custom_domain": true
			},
			"r2_buckets": [
				{
					"binding": "DTXFILE_BUCKET",
					"bucket_name": "simfile-dtx-preprod"
				}
			],
			"kv_namespaces": [
				{
					"binding": "RATE_LIMIT_API",
					"id": "REPLACE_WITH_PREPROD_KV_ID"
				}
			],
			"d1_databases": [
				{
					"binding": "DB",
					"database_name": "dtx-web-preprod",
					"database_id": "6fedd126-9dcf-419f-bc2e-eaf8c23d9510"
				}
			],
			"vars": {
				"SUPABASE_URL": "REPLACE_WITH_PUBLIC_SUPABASE_URL",
				"SUPABASE_ANON_KEY": "REPLACE_WITH_PUBLIC_SUPABASE_ANON_KEY",
				"RATE_LIMIT_ENV": "pre-prod",
				"GRAPHIQL": "true",
				"CORS_ALLOWED_ORIGINS": "https://pre-prod.dtx.hapadona.com,http://localhost:5173,http://localhost:8788",
				"PUBLIC_ENABLE_BLOG_DOWNLOAD": "false"
			}
		},
		"pre-prod-prod-data": {
			"route": {
				"pattern": "api.pre-prod.dtx.hapadona.com",
				"custom_domain": true
			},
			"r2_buckets": [
				{
					"binding": "DTXFILE_BUCKET",
					"bucket_name": "simfile-dtx"
				}
			],
			"kv_namespaces": [
				{
					"binding": "RATE_LIMIT_API",
					"id": "REPLACE_WITH_PREPROD_PROD_DATA_KV_ID"
				}
			],
			"d1_databases": [
				{
					"binding": "DB",
					"database_name": "dtx-web",
					"database_id": "19376000-d389-4e0e-a5a8-00d9e31a9ffb"
				}
			],
			"vars": {
				"SUPABASE_URL": "REPLACE_WITH_PUBLIC_SUPABASE_URL",
				"SUPABASE_ANON_KEY": "REPLACE_WITH_PUBLIC_SUPABASE_ANON_KEY",
				"RATE_LIMIT_ENV": "pre-prod-prod-data",
				"GRAPHIQL": "true",
				"CORS_ALLOWED_ORIGINS": "https://pre-prod.dtx.hapadona.com,http://localhost:5173,http://localhost:8788",
				"PUBLIC_ENABLE_BLOG_DOWNLOAD": "false"
			}
		}
	}
}
```

Five `REPLACE_*` placeholders remain in the file:

1. `REPLACE_WITH_PROD_KV_ID` — fill in Task 10, Step 2.
2. `REPLACE_WITH_PREPROD_KV_ID` — fill in Task 10, Step 2.
3. `REPLACE_WITH_PREPROD_PROD_DATA_KV_ID` — fill in Task 10, Step 2.
4. `REPLACE_WITH_PUBLIC_SUPABASE_URL` (×3) — fill in Step 2 below (copy from `dtx-web`'s build config / Cloudflare dashboard).
5. `REPLACE_WITH_PUBLIC_SUPABASE_ANON_KEY` (×3) — fill in Step 2 below.

- [ ] **Step 2: Look up `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` and substitute them**

These values are public (the anon key is designed to be shipped to browsers). They are already configured on the `dtx-web` Worker. Find the current values:

```bash
bunx wrangler --config packages/dtx-web/wrangler.jsonc secret list 2>/dev/null || true
```

If they aren't there, check `packages/dtx-web/.env`, `packages/dtx-web/.env.production`, or pull them from the Cloudflare dashboard's variables-and-secrets page for the `dtx-web` Worker. Confirm with the project owner if uncertain.

Substitute all three `REPLACE_WITH_PUBLIC_SUPABASE_URL` and all three `REPLACE_WITH_PUBLIC_SUPABASE_ANON_KEY` occurrences in `packages/dtx-api/wrangler.jsonc` with the actual values.

Verify only the three KV ID placeholders remain:

```bash
grep -n 'REPLACE_' packages/dtx-api/wrangler.jsonc
```

Expected: three matches, all `REPLACE_*KV_ID`.

- [ ] **Step 3: Add deploy scripts to the root `package.json`**

Open `/package.json`. Find:

```jsonc
		"deploy:web": "bun run --filter=dtx-web deploy:prod",
		"deploy:web:preprod": "bun run --filter=dtx-web deploy:preprod",
		"deploy:web:preprod:prod-data": "bun run --filter=dtx-web deploy:preprod:prod-data",
```

Append three sibling entries immediately after that block:

```jsonc
		"deploy:api": "bun run --filter=dtx-api deploy:prod",
		"deploy:api:preprod": "bun run --filter=dtx-api deploy:preprod",
		"deploy:api:preprod:prod-data": "bun run --filter=dtx-api deploy:preprod:prod-data",
```

- [ ] **Step 4: Verify the wrangler config parses**

Run: `bun run --filter=dtx-api build`

Expected: `wrangler deploy --dry-run --outdir=dist` runs. Either succeeds (printing bundle size) or fails because the KV ID isn't a UUID. A KV-ID parse failure is acceptable at this step (Task 10 fills the real IDs); a syntax error in the JSONC is not.

If the failure is anything other than "KV namespace ID invalid" / "binding ... id" → diagnose and fix.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-api/wrangler.jsonc package.json
git commit -m "chore(dtx-api): add wrangler config + root deploy scripts

Three envs (prod / pre-prod / pre-prod-prod-data) mirroring
dtx-web. KV namespace IDs are placeholders pending Task 10
manual setup. Phase 1 of the API server migration."
```

---

## Task 10: Create KV namespaces and deploy to pre-prod

**Files:**

- Modify: `packages/dtx-api/wrangler.jsonc` (paste real KV IDs)

This task is the first time we interact with Cloudflare. It must be run by an operator who can authenticate to the project's CF account.

- [ ] **Step 1: Authenticate `wrangler` to Cloudflare**

If not already authenticated:

```bash
bunx wrangler login
```

Verify:

```bash
bunx wrangler whoami
```

Expected: shows the project's Cloudflare account email.

- [ ] **Step 2: Create the three KV namespaces**

```bash
bunx wrangler kv namespace create RATE_LIMIT_API
bunx wrangler kv namespace create RATE_LIMIT_API --env pre-prod
bunx wrangler kv namespace create RATE_LIMIT_API --env pre-prod-prod-data
```

Each command prints the new namespace's ID. Copy each ID and paste it into the matching `REPLACE_WITH_*_KV_ID` slot in `packages/dtx-api/wrangler.jsonc`:

- First command's ID → `REPLACE_WITH_PROD_KV_ID`
- Second → `REPLACE_WITH_PREPROD_KV_ID`
- Third → `REPLACE_WITH_PREPROD_PROD_DATA_KV_ID`

Verify no placeholders remain:

```bash
grep -n 'REPLACE_' packages/dtx-api/wrangler.jsonc
```

Expected: no matches.

(If `wrangler kv namespace create` complains about an already-existing namespace, run `bunx wrangler kv namespace list` and pick the existing ID instead.)

- [ ] **Step 3: Verify the wrangler config dry-runs cleanly**

Run: `bun run --filter=dtx-api build`
Expected: dry-run succeeds, prints a bundle size summary. Note the bundle size — must be <1 MB (free tier limit). Phase 1 expects well under 300 KB.

- [ ] **Step 4: Deploy to pre-prod**

```bash
bun run deploy:api:preprod
```

Expected: wrangler uploads the Worker and prints a deployment URL. The first deploy attaches the `api.pre-prod.dtx.hapadona.com` custom domain. If wrangler reports that the custom domain isn't claimable, the subdomain isn't in the `hapadona.com` zone — request the zone owner add it, then re-run.

- [ ] **Step 5: Smoke-test the deployed Worker**

```bash
curl -sS https://api.pre-prod.dtx.hapadona.com/healthz | jq .
```

Expected:

```json
{
	"ok": true,
	"service": "dtx-api",
	"version": "0.0.1",
	"buildSha": "dev"
}
```

```bash
curl -sS -X POST https://api.pre-prod.dtx.hapadona.com/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ healthz }"}' | jq .
```

Expected:

```json
{ "data": { "healthz": "ok" } }
```

```bash
curl -sS -I -X OPTIONS https://api.pre-prod.dtx.hapadona.com/graphql \
  -H 'Origin: https://pre-prod.dtx.hapadona.com' \
  -H 'Access-Control-Request-Method: POST'
```

Expected: `204` with `Access-Control-Allow-Origin: https://pre-prod.dtx.hapadona.com`.

```bash
curl -sS -I -X OPTIONS https://api.pre-prod.dtx.hapadona.com/graphql \
  -H 'Origin: https://evil.example.com'
```

Expected: `204` without `Access-Control-Allow-Origin`.

Manual check: open `https://api.pre-prod.dtx.hapadona.com/graphql` in a browser → GraphiQL playground loads. Run `{ healthz }` from the playground → returns `"ok"`.

- [ ] **Step 6: Commit the populated wrangler.jsonc**

```bash
git add packages/dtx-api/wrangler.jsonc
git commit -m "chore(dtx-api): pin KV namespace IDs and deploy to pre-prod

Three RATE_LIMIT_API KV namespaces created per env. First
pre-prod deploy succeeded: /healthz, GraphQL Query.healthz,
and CORS allow-list all behave as expected. Phase 1 of the
API server migration."
```

---

## Task 11: Final cleanup and verification

**Files:** none (verification + format only)

- [ ] **Step 1: Run formatter**

Run: `bun run format`

Expected: prettier rewrites formatting in the new files only. Inspect with `git diff --stat`.

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: pass.

- [ ] **Step 3: Run all test suites**

Run: `bun run --filter=@dtx/common test`
Expected: all tests pass.

Run: `bun run --filter=dtx-api test`
Expected: all tests pass (22 tests across 4 files).

Run: `bun run --filter=dtx-web test`
Expected: pass (dtx-web is unaffected — verify nothing regressed).

- [ ] **Step 4: Type-check everything**

Run: `bun run --filter=@dtx/common check`
Expected: 0 errors.

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

Run: `bun run --filter=dtx-web check`
Expected: 0 errors.

- [ ] **Step 5: Verify the published `@dtx/common` package shape**

Run: `bun run --filter=@dtx/common build`
Expected: build succeeds.

Verify the new export is in the declaration file:

```bash
grep -E "workerLogger" packages/common/dist/server.d.ts
```

Expected: at least one match.

- [ ] **Step 6: Verify the dtx-api bundle size**

Run: `bun run --filter=dtx-api build`
Expected: dry-run succeeds. Read the printed `Total Upload` size — must be under 1 MB. Phase 1 target is under 300 KB. If it's higher than 300 KB, inspect dependencies (`bunx wrangler deploy --dry-run --outdir=dist` writes to `packages/dtx-api/dist`; `du -sh packages/dtx-api/dist/*.js`).

- [ ] **Step 7: Commit any formatter changes**

If `git status` shows lint/format changes:

```bash
git add -A
git commit -m "chore: format after Phase 1 scaffold"
```

If no changes: skip the commit.

- [ ] **Step 8: Final sanity check — exercise the deployed pre-prod endpoint once more**

```bash
curl -sS https://api.pre-prod.dtx.hapadona.com/healthz
curl -sS -X POST https://api.pre-prod.dtx.hapadona.com/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ healthz }"}'
```

Both calls should still succeed (the deploy from Task 10 is what we're verifying remains reachable).

---

## Done criteria

- All 11 tasks complete.
- `git log --oneline -11` shows commits for: workerLogger, scaffold, Env, verifyToken, CORS, healthz, GraphQL, Worker entry, wrangler config, KV IDs + deploy, (optional) format.
- `packages/dtx-api/` exists with the layout described in the design spec.
- `bun run --filter=dtx-api test` reports 22 tests passing across 4 files.
- `bun run --filter=dtx-api check` passes.
- `bun run --filter=@dtx/common test` and `bun run --filter=@dtx/common check` pass.
- `bun run lint` passes.
- `bun run --filter=dtx-web test` passes (zero regression).
- `https://api.pre-prod.dtx.hapadona.com/healthz` returns the expected JSON envelope.
- `https://api.pre-prod.dtx.hapadona.com/graphql` (POST `{ healthz }`) returns `{ data: { healthz: "ok" } }`.
- `https://api.pre-prod.dtx.hapadona.com/graphql` (GET) loads the GraphiQL playground.
- CORS preflight from `pre-prod.dtx.hapadona.com` succeeds; preflight from a foreign origin is silently denied.
- Wrangler bundle size is under 1 MB (target: under 300 KB).
- Zero changes outside `packages/common/src/lib/server/`, `packages/common/src/lib/server.ts`, `packages/dtx-api/`, and `/package.json`.

## Open follow-ups (out of scope for Phase 1)

These are deferred to later phases or follow-up tickets, not blocking this plan:

- Wire `wrangler.jsonc`'s `__BUILD_SHA__` define from the deploy script (`git rev-parse --short HEAD`). Right now `/healthz` returns `"dev"` in production until this is added — acceptable for Phase 1.
- Replace the per-request `supabase.auth.getUser(token)` round-trip with local JWKS verification to cut latency. Profile after Phase 2 lands real traffic.
- Decide whether `wrangler dev` should run against pre-prod bindings (`--env pre-prod --remote`) or local-only mocks. Document the pick in `packages/dtx-api/README.md` after the team has used both.
