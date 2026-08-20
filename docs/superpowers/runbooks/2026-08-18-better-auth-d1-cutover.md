# Better Auth and D1 production cutover runbook

This runbook is for the production operator executing the Better Auth + D1
cutover after the Task 14 repository gates and the separate pre-production
acceptance gate pass. It is an operator procedure, not an automated test or a
request to perform production actions from this task. Do not put credentials,
tokens, exports, or generated SQL containing user data in Git.

The production API and web hostnames remain `api.dtx.hapadona.com` and
`dtx.hapadona.com`. Pre-production remains `api.pre-prod.dtx.hapadona.com`
and `pre-prod.dtx.hapadona.com`. Google Drive OAuth is independent from the
application's Google sign-in provider.

## Backup/export

Before changing a remote environment, the operator must:

1. Record the current Git commit, deployed Worker versions, Wrangler account,
   D1 database names/IDs, R2 bucket, KV namespace, and the current secret
   presence without printing secret values.
2. Export a D1 backup for the target environment using the approved Cloudflare
   procedure. For a CLI export, use an explicit output path outside the
   repository and verify the command targets the intended remote database:

    ```bash
    bunx wrangler d1 export <database-name> --remote --output <secure-backup-path>
    ```

    Retain the immutable export and a checksum under the operator's protected
    change record. Do not commit it.

3. Export the Supabase Auth users/accounts and the application rows needed for
   ownership reconciliation using an approved Supabase Admin export. Keep the
   raw export access-controlled and read-only. Never paste the service-role key
   or raw export into a ticket, shell history, or repository.
4. Capture a rollback web/API deployment version and confirm that the previous
   D1 backup can be restored or queried before proceeding.

## Pinned Better Auth version

The reviewed versions are exact and must remain aligned:

```text
better-auth 1.6.30
auth         1.6.30  (Better Auth CLI package)
```

The operator must deploy the reviewed lockfile and verify that both package
versions are unchanged. Do not upgrade to a newer 1.6.x or 1.7.x patch during
the cutover. The desktop binary and web/API deployment must come from the same
reviewed commit.

## Cookie prefixes/domains

Verify these values in the selected API Wrangler environment before deploying:

| Environment    | `AUTH_COOKIE_PREFIX` | `AUTH_COOKIE_DOMAIN`        | `DTX_WEB_URL`                       |
| -------------- | -------------------- | --------------------------- | ----------------------------------- |
| production     | `dtx`                | `dtx.hapadona.com`          | `https://dtx.hapadona.com`          |
| pre-production | `dtx-preprod`        | `pre-prod.dtx.hapadona.com` | `https://pre-prod.dtx.hapadona.com` |
| local E2E      | `dtx-local`          | omitted                     | `http://localhost:5173`             |

Production and pre-production prefixes must remain different. The production
domain cookie scope includes nested pre-production hosts, so a shared prefix
can cause a production session to be interpreted by pre-production. Confirm
that browser responses contain the expected environment prefix and domain, and
that a production `dtx.*` cookie is not accepted as a pre-production session.

## Trusted web origins

`DTX_WEB_URL` is the only Better Auth `trustedOrigins` input. It must be the
exact web origin for the selected environment, with no path and no trailing
slash requirement beyond normal URL parsing. `CORS_ALLOWED_ORIGINS` is a
separate CORS allowlist and must never be copied into `trustedOrigins`.

For production, verify that `https://dtx.hapadona.com` is trusted and that
localhost and pre-production origins are not. For pre-production, verify that
`https://pre-prod.dtx.hapadona.com` is trusted; any localhost entries needed
for CORS smoke tests remain CORS-only.

Also verify credentialed CORS on both preflight and normal responses, exact
origin echoing, and no allow-origin header for a disallowed origin. Unsafe
cookie-authenticated requests must require the canonical web origin; Bearer
requests from the desktop do not rely on a browser Origin.

## Service binding

Verify the deployed web Worker uses the API service binding for SSR session
lookup:

| Web environment                     | Binding | API Worker service           |
| ----------------------------------- | ------- | ---------------------------- |
| production                          | `API`   | `dtx-api`                    |
| pre-production                      | `API`   | `dtx-api-pre-prod`           |
| pre-production with production data | `API`   | `dtx-api-pre-prod-prod-data` |

The public API URL remains configured for browser/client calls. Production SSR
`/get-session` must use `event.platform.env.API` rather than making a public
round-trip, while local Vite/non-Workers execution may use the configured
public URL. Confirm the binding resolves in Wrangler validation and that
`/get-session` is exempt from database-backed rate limiting.

## Google callbacks

Register and verify the exact Better Auth callback in the Google OAuth client
for each environment:

```text
https://api.dtx.hapadona.com/api/auth/callback/google
https://api.pre-prod.dtx.hapadona.com/api/auth/callback/google
```

The callback is an API callback, not the old `/login?redirect=desktop` handoff.
Verify password sign-in, Google sign-in, explicit account linking, and the
disabled implicit-linking/signup policy. Keep the Google Drive OAuth callback
and credentials separate from these application callbacks.

## Wrangler secrets

Set and verify the following API Worker secrets independently in production and
pre-production. Use `wrangler secret put` interactively or the approved secret
manager; never place values in `wrangler.jsonc`, shell history, logs, or this
runbook:

```text
BETTER_AUTH_SECRET
GOOGLE_AUTH_CLIENT_SECRET
```

Retain the existing optional cache-purge secrets only if the deployment uses
that feature:

```text
CLOUDFLARE_ZONE_ID
CLOUDFLARE_API_TOKEN
```

Confirm secret names and presence with a metadata-only check. The desktop never
receives `BETTER_AUTH_SECRET`. `BETTER_AUTH_DEVICE_CODE_EXPIRES_IN` is an
optional local-E2E test override; do not set the 1-second test value in
production or pre-production. Production uses the Better Auth default device
code lifetime unless a separately reviewed operator change says otherwise.

## Supabase Admin export

Supabase is an input source for the one-shot identity migration only; it is not
a production runtime dependency after cutover. The operator must:

1. Take a read-only Supabase Auth Admin export containing users and supported
   identity/account data, plus the application owner-ID inventory.
2. Confirm the export is from the intended Supabase project and freeze account
   mutations for the approved change window, or record the exact delta/retry
   procedure.
3. Preserve UUIDs, names, email verification state, identity data, and source
   timestamps. Do not import sessions, refresh tokens, access tokens, or other
   transient credentials.
4. Store the raw export only in the protected operator workspace. The importer
   accepts the sanitized export as input; it does not connect to Supabase or
   write a remote D1 database.

## Generated import SQL review

Run the pinned local importer from the reviewed commit, supplying an explicit
owner-ID file. Generate SQL into a protected path outside the repository:

```bash
bun run --filter=dtx-api auth:migrate \
  --input <sanitized-supabase-export.json> \
  --owner-ids <application-owner-ids.json> \
  --output <reviewed-auth-import.sql>
```

Before applying anything, a second operator reviews the generated SQL and
records that:

- only Better Auth `user` and `account` rows are generated;
- source UUIDs and timestamps are preserved;
- credential accounts have explicitly supplied replacement passwords;
- unsupported providers, duplicate identities, malformed UUIDs, and SQL
  escaping failures are rejected;
- sessions/tokens are absent;
- every application owner ID is present and exactly reconciled; and
- the SQL target is the selected environment, with no production SQL applied
  during a pre-production rehearsal.

The output is reviewed input to the D1 operation, not a migration replacement.
Do not edit generated SQL to bypass an invariant; fix the sanitized input and
regenerate it.

## D1 migration order

Use Wrangler's migration history as the authority and apply the existing
migrations in order. The reviewed sequence is:

```text
0001_initial_schema.sql
0002_scores.sql
0003_chart_scores_user_updated_index.sql
0004_normalize_legacy_dtx_file_levels.sql
0005_fix_level_decoding_formula.sql
0006_google_drive_file_id.sql
0007_score_semantics.sql
0008_better_auth.sql
```

Apply to the isolated pre-production database first, then verify the schema and
row counts. Only after pre-production acceptance and the production go/no-go
gate may the operator apply the same forward-only sequence to production. Do
not run a local/runtime migration runner, skip `0008`, or apply the identity
import before `0008_better_auth.sql` exists.

## Owner reconciliation

There is no application ownership foreign key that can repair an identity
mismatch automatically. The operator must compare the complete application
owner-ID inventory with the imported Better Auth user IDs and obtain an exact
zero-difference result for every owned chart/score/linkage row.

Record counts and a non-secret checksum of the reconciliation. Any missing,
extra, or changed owner ID is a hard stop. Do not deploy the cutover or delete
Supabase access while reconciliation is incomplete.

## Deployment order

For each environment, use this order:

1. Freeze the change window and complete backup/export, secret, callback,
   cookie, origin, and migration checks.
2. Apply the D1 migrations and then the reviewed identity SQL to the target
   database only.
3. Deploy the API Worker and verify `/healthz`, Better Auth routes, cookies,
   CORS, callback start, and GraphQL/REST authorization.
4. Deploy the web Worker with the matching `API` service binding and verify SSR
   session lookup, `/app` policy, downloads, and logout.
5. Build the desktop candidate pointing at the target API, then run the desktop
   acceptance matrix. Do not publish a desktop binary until the web/API gate
   passes.
6. Complete the Access matrix and go/no-go record. Keep the previous web/API
   versions and D1 backup available until the observation window closes.

## Web matrix

The operator records pass/fail evidence for both production and pre-production:

| Flow                 | Expected evidence                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Password login       | Better Auth cookie session; redirect to `/app`; no Supabase request                                 |
| Google login         | Google callback terminates at API; session uses environment cookie                                  |
| Explicit linking     | Existing account can link Google; implicit linking/signup remain disabled                           |
| `/app` guard         | Anonymous user is redirected safely to `/login`; no unsafe `next` path                              |
| GraphQL/score        | Authenticated cookie request succeeds; anonymous/invalid session is unauthorized                    |
| Download             | Authenticated permitted download succeeds; rate-limit/resource policy remains                       |
| Logout               | Sign-out revokes session and subsequent `/get-session` is null                                      |
| Invalid session      | Invalid cookie is cleared/redirected and cannot access `/app`                                       |
| Device Authorization | Code request, browser claim/approve, poll, session validation, revoke, deny, and expiry pass        |
| Cookie/origin        | Prefix/domain isolation, multi-value `Set-Cookie`, credentialed CORS, and unsafe Origin checks pass |

The automated Playwright suite covers the local API/D1 lifecycle. A production
operator must additionally run the real deployed web matrix; local GREEN is not
production proof.

## Desktop matrix

The operator records pass/fail evidence for a candidate built with the target
API URL:

| Flow                 | Expected evidence                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Native restore       | Renderer restores `{ sessionToken, user }` and native validation accepts it                                           |
| Authenticated shell  | Library/cloud behavior and user controls are visible only while authenticated                                         |
| Device Authorization | Login requests a real code, opens the verification URI in the OS browser, and polling yields an opaque session        |
| Manual handoff       | On a real OS browser, open `/app/desktop-auth`, enter the code, authenticate, approve, and return to the desktop poll |
| Logout/invalid       | Logout clears renderer storage and native state; invalid/expired/denied polls return to a safe login state            |
| Legacy residue       | No Supabase-shaped session seed, fake refresh token, callback URL, or production test-auth endpoint                   |

WDIO coverage is automated and uses only the existing compile-time-gated
`e2e + debug_assertions` native seed. The real OS-browser-open handoff is
manual evidence because stable WDIO coverage does not own the host browser.
Record these as separate automated and manual evidence; do not mark the manual
handoff green based on the renderer seed alone.

## Access matrix

Verify the edge policy separately from application authentication:

| Surface                    | Production                                       | Pre-production                                                      |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| Web `/app`                 | Production operator policy remains enforced      | Existing pre-production Cloudflare Access behavior remains enforced |
| API public host            | Public hostname remains `api.dtx.hapadona.com`   | Public hostname remains `api.pre-prod.dtx.hapadona.com`             |
| Better Auth browser origin | `https://dtx.hapadona.com` only                  | `https://pre-prod.dtx.hapadona.com` only                            |
| Localhost CORS             | Not a trusted auth origin                        | May be CORS-only for approved testing; never a trusted auth origin  |
| Desktop API bearer         | Candidate uses opaque Better Auth bearer session | Candidate uses opaque Better Auth bearer session                    |

Check that Access redirects do not rewrite the Better Auth callback, that the
API host remains reachable according to the existing policy, and that an
environment's cookies do not cross the other environment.

## Go/no-go

The change owner and operator must both record a go/no-go decision. **No-go**
if any item is false:

- reviewed commit and exact Better Auth/CLI `1.6.30` pins are deployed;
- pre-production static, unit, Rust, web E2E, desktop E2E, and manual OS-browser
  handoff evidence pass;
- D1 backup/export and rollback versions are verified;
- migrations and identity import SQL were reviewed and applied to the intended
  database only;
- owner reconciliation is exact and complete;
- cookie prefixes/domains, trusted origins, CORS, service binding, and Google
  callbacks are verified;
- web password/Google/linking/GraphQL/download/logout and Device Authorization
  flows pass;
- desktop restore, authenticated behavior, Device Authorization, logout, and
  invalid/denied/expired behavior pass; and
- Access policy and public hostnames remain unchanged.

Task 14 does not authorize production migration, deployment, desktop
publication, Supabase credential removal, or any remote operation. Those are
operator actions after this gate.

## Production cutover

After a recorded **go** only, the operator executes the approved change window:

1. Take the final D1/Supabase exports and record checksums.
2. Apply `0008_better_auth.sql` after the existing migration history is
   confirmed, then apply the reviewed identity SQL and verify counts.
3. Deploy the API Worker, run health/auth/CORS/callback checks, and watch logs.
4. Deploy the web Worker with `API -> dtx-api`, then run the web matrix.
5. Build/publish the desktop candidate only after web/API acceptance, then run
   the desktop matrix and the manual OS-browser handoff.
6. Keep the rollback versions, backups, and observation owner active for the
   agreed window. Record only non-secret outcomes in the change record.

## Supabase-disable proof

Do not remove Supabase credentials until the observation window and the proof
below pass:

- repository residue gates show no runtime Supabase import/config/test path;
- deployed Worker logs and network traces show no Supabase runtime request;
- password, Google, linking, GraphQL, REST/download, logout, and Device
  Authorization flows pass against Better Auth/D1;
- desktop uses the Better Auth opaque session and no legacy refresh/callback
  path; and
- owner reconciliation, row counts, and error logs remain clean.

Then remove or disable only the approved legacy Supabase production credentials
through the secret manager and record the timestamp. Keep the raw export and
rollback artifacts under the approved retention policy. Never treat a passing
local test as proof that Supabase can be disabled in production.

## Rollback

If health, auth, ownership, callback, Access, or acceptance checks fail:

1. Stop the cutover and do not publish the desktop candidate or disable
   Supabase credentials.
2. Preserve logs, request IDs, non-secret response evidence, migration history,
   and the exact deployed commit. Do not delete the backup or generated SQL.
3. Roll back the API and web Workers to the recorded previous versions in the
   approved Cloudflare procedure. Restore the previous Access/routing config if
   it changed.
4. Do not attempt an ad hoc down migration. D1 migrations are forward-only;
   restore from the approved backup or apply a separately reviewed corrective
   migration under operator change control.
5. Restore application ownership/session behavior from the approved backup or
   corrective import plan, then verify the old web/API matrix before reopening
   traffic.
6. Revoke or rotate only credentials explicitly identified as compromised. Keep
   `BETTER_AUTH_SECRET` and Supabase credentials available until the rollback
   decision is complete.

## PR #221 documentation reconciliation

The current local checkout contains no PR #221 Zero Trust specification, plan,
or runbook document to edit. The bounded local search found only Task 14 plan
references and an unrelated color literal (`#221E3A`). Therefore no PR #221
document was modified in this task. When those documents land locally, reconcile
them by replacing the Supabase inner gate with Better Auth and replacing
`/login?redirect=desktop` callbacks with `/app/desktop-auth` Device
Authorization, while preserving the production `/app` operator policy,
pre-production Access behavior, and public API hostnames.
