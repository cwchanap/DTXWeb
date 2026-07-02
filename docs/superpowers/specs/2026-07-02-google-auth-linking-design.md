# Google Auth and Account Linking Design

## Goal

Add Google authentication to Drumery without opening public signup.

Existing password users must be able to connect a Google account, including a Google account whose email address differs from the existing Drumery account email. The linked account must preserve the existing Supabase user id so existing Drumery data keyed by `simfiles.user_id` and `user_profiles.user_id` remains attached.

## Current Context

Drumery already uses Supabase Auth across the web, desktop, and API surfaces:

- `packages/dtx-web` uses `@supabase/ssr` in `hooks.server.ts` and the root layout to manage Supabase cookie sessions.
- `/login` currently supports only email/password through `supabase.auth.signInWithPassword`.
- `packages/dtx-desktop` opens the web login URL and receives a Supabase magic-link handoff through the existing `dtx://auth-callback` or local callback bridge.
- `packages/dtx-api` does not own identity state. It validates Supabase bearer tokens and uses the resulting Supabase user id for authorization.
- D1 ownership is keyed directly by Supabase user id, so creating a second Supabase user for an existing person would orphan their existing content from the new login.

Supabase manual identity linking is the intended mechanism for connecting a different-email Google identity to an already signed-in user. This requires manual linking to be enabled in Supabase Auth configuration.

## Chosen Approach

Use Supabase-native Google OAuth plus Supabase manual identity linking.

This keeps Supabase as the sole auth authority, preserves the existing Drumery API token model, and avoids a separate Drumery-owned OAuth/user-linking table. Google sign-in and Google account linking are separate flows:

- Logged-out users use Google sign-in only for accounts that already have a linked Google identity.
- Logged-in password users use an account page to connect Google to their current Supabase user.

## Deployment Prerequisites

The Supabase project must be configured before release:

- Google OAuth provider enabled with the correct production and local redirect URLs.
- New user signup disabled. Users can still be created by existing admin/invite/manual processes, but Google must not create public self-service accounts.
- Manual identity linking enabled so signed-in users can link OAuth identities whose email differs from their current account email.
- The web app OAuth callback URL registered in Supabase and Google OAuth configuration.

The app should treat missing manual linking support as a configuration error. It must not silently fall back to creating users or changing D1 ownership.

## Web Login Flow

`/login` keeps the existing email/password form and adds a Google option.

The Google button starts Supabase OAuth with `provider: 'google'` and a redirect back to the Drumery-owned `/auth/callback` route. The callback exchanges the OAuth code with Supabase using the existing SSR client so Supabase session cookies are written normally.

Successful callback redirects:

- Standard web login: `/app`
- Desktop login: `/app?redirect=desktop`

Failed callback redirects back to `/login` with a sanitized, user-facing error. For unknown Google users rejected by the signup-disabled Supabase configuration, the message should say that Google sign-in is available only for existing linked accounts.

The login page must not include signup copy, signup links, or a "create account with Google" path.

## Account Linking Flow

Add a protected account/profile destination under the authenticated web app.

The account page should show:

- Current account email.
- Linked providers, including whether Google is connected.
- A "Connect Google" action when Google is not linked.

The connect action uses `supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } })` from an authenticated session. Because the user is already signed in, Supabase links the selected Google identity to the current Supabase user id, even when the Google email is different.

After the OAuth return, the page reloads identities and shows Google as connected. The page should surface these error cases:

- Manual linking disabled: configuration error.
- Google identity already linked to another Supabase user: conflict message.
- OAuth cancelled or failed: non-destructive retry message.

No D1 migration or ownership rewrite should happen as part of account linking.

## Desktop Flow

Desktop keeps the current web-mediated login path.

The desktop renderer opens `/login?redirect=desktop`. The user may authenticate with password or, after linking, with Google. Once the web app has a Supabase session, `/app?redirect=desktop` continues to generate the existing magic link and redirects to the configured desktop callback URL with `magic_link=...`.

The Tauri Rust callback parser and magic-link verification path should remain unchanged unless implementation testing proves the Google session has a different shape. The expected result is the same Supabase session payload and user object.

## API Boundary

`dtx-api` should remain bearer-token based. It should not add OAuth provider logic, duplicate user identity tables, or provider-specific authorization paths.

API changes are only in scope if the web account UI needs server-owned metadata that cannot be obtained from Supabase Auth client APIs. The initial design assumes the web client can read linked identities directly from Supabase.

## Security Guardrails

- Do not call `supabase.auth.signUp`.
- Do not add a public signup route.
- Do not describe Google as account creation.
- Do not allow anonymous users to link identities.
- Do not create or migrate D1 ownership rows during auth.
- Do not expose raw OAuth errors, provider tokens, magic links, or token hashes in UI or logs.
- Treat Supabase signup-disabled behavior as the primary no-open-signup enforcement, with app messaging layered on top.

## Testing Plan

Targeted tests should cover:

- `/login` renders password and Google sign-in options without signup copy.
- Google login initiation passes the expected provider and redirect target.
- OAuth callback exchanges `code`, redirects to `/app`, and preserves desktop redirects.
- OAuth callback errors return to `/login` with a sanitized message.
- Account page shows linked provider state.
- Connect Google calls `linkIdentity`, not `signInWithOAuth`.
- Manual-linking-disabled and provider-conflict errors render clear messages.

Verification commands:

- `bun run --filter=dtx-web test -- <relevant test files>`
- `bun run --filter=dtx-web check`
- `bun run --filter=dtx-desktop test -- authService.test.ts` only if desktop login URL or redirect behavior changes.

Per repository guidance, do not run broad development servers or full builds unless explicitly requested.

## Out Of Scope

- Opening public signup.
- Replacing password login.
- Reworking desktop auth callbacks.
- Changing `dtx-api` token verification.
- D1 ownership migration.
- Admin invite/user-creation tooling.
