# Cloudflare Zero Trust Web Access Design

## Summary

DTXWeb will use Cloudflare Zero Trust Access as an outer access gate for the authenticated web application surface while preserving the public website and existing Supabase authentication flow.

Production will protect only the authenticated application routes under `/app`. Pre-production will protect the entire web hostname. The GraphQL API hostnames remain outside Cloudflare Access so web and desktop API clients do not need service tokens or Access-specific request headers.

The Zero Trust configuration will be managed manually in the Cloudflare dashboard. This slice does not introduce Pulumi, Terraform, CI deployment, Worker-side Access JWT validation, or any other infrastructure-as-code layer.

## Goals

- Require Cloudflare Access before users can reach production `/app` routes.
- Keep production public routes such as `/`, `/blog`, `/preview`, `/editor`, `/login`, and `/auth/*` outside Cloudflare Access.
- Require Cloudflare Access for every route served by `pre-prod.dtx.hapadona.com`.
- Reuse the same identity and trusted-device posture model already used for Perseus admin access.
- Preserve the existing Supabase application authentication as an independent inner gate.
- Keep both production and pre-production API hostnames outside Cloudflare Access.
- Document the intended dashboard configuration and verification procedure in the repository so future manual edits have a source of truth.

## Non-Goals

- Add Pulumi, Terraform, or another infrastructure-as-code system to DTXWeb.
- Protect the entire production `dtx.hapadona.com` hostname.
- Protect `api.dtx.hapadona.com` or `api.pre-prod.dtx.hapadona.com`.
- Replace Supabase authentication.
- Add Worker-side validation of `CF_Authorization` or Access JWTs.
- Add Cloudflare Access service tokens for desktop, API, CLI, or CI traffic.
- Protect preview/development Worker URLs outside the named production and pre-production custom hostnames.
- Change SvelteKit, GraphQL API, or desktop application code as part of this slice.

## Existing Context

`packages/dtx-web/wrangler.jsonc` deploys the production web Worker to `dtx.hapadona.com` and the pre-production web Worker to `pre-prod.dtx.hapadona.com`. The web application calls a separate GraphQL API at `api.dtx.hapadona.com` in production and `api.pre-prod.dtx.hapadona.com` in pre-production.

`packages/dtx-web/src/hooks.server.ts` already treats `/app` as the application-authenticated route family. An unauthenticated request to `/app` is redirected to the public `/login` route, after which the existing Supabase flow returns the browser to `/app`.

The desktop login flow also opens the web `/login` route and eventually returns through `/app?redirect=desktop...`. Production `/login` therefore must stay public while `/app` is Access-protected.

The repository documents Cloudflare Worker deployments as manual and currently has no infrastructure deployment package or CI workflow. Zero Trust should follow that operating model for now.

## Protection Matrix

| Surface | Cloudflare Access | Notes |
| --- | --- | --- |
| `dtx.hapadona.com/app` | Protected | Exact parent route must be covered. |
| `dtx.hapadona.com/app/*` | Protected | Covers all descendants explicitly. |
| `dtx.hapadona.com/` | Public | Landing page remains public. |
| `dtx.hapadona.com/blog/*` | Public | Public content remains public. |
| `dtx.hapadona.com/preview/*` | Public | Public tool remains public. |
| `dtx.hapadona.com/editor/*` | Public | Public tool remains public. |
| `dtx.hapadona.com/login` | Public | Required by normal web and desktop login entry flows. |
| `dtx.hapadona.com/auth/*` | Public | Supabase/OAuth callback routes remain public. |
| Other production web routes outside `/app` | Public | Do not broaden the production application accidentally. |
| `pre-prod.dtx.hapadona.com/*` | Protected | Entire pre-production web hostname is private. |
| `api.dtx.hapadona.com/*` | Public to Access | Existing API/application auth remains authoritative. |
| `api.pre-prod.dtx.hapadona.com/*` | Public to Access | Existing API/application auth remains authoritative. |

Cloudflare documents that a wildcard path such as `/app/*` does not cover the parent `/app`. The production Access application therefore records both the exact parent and wildcard descendant destinations instead of relying on path inheritance.

## Access Applications

### Production

Create one self-hosted public-hostname Access application named `DTXWeb Production App` with exactly these destinations:

- `dtx.hapadona.com/app`
- `dtx.hapadona.com/app/*`

Do not add a hostname-wide production destination. Do not add `/login`, `/auth/*`, `/blog`, `/preview`, `/editor`, or other public routes.

### Pre-production

Create a second self-hosted public-hostname Access application named `DTXWeb Pre-prod` for the entire hostname:

- `pre-prod.dtx.hapadona.com`

No path exception is required. Because the entire hostname is protected, `/`, `/login`, `/auth/*`, `/blog`, `/preview`, `/editor`, `/app`, and future routes on the pre-production web hostname all require Access first.

## Access Policy

Both applications use the same policy semantics:

- Action: `Allow`.
- Include: the intended operator identity/email used for the existing Perseus Zero Trust access.
- Require: the trusted-device serial-number posture check used for Perseus.
- Session duration: `12h`, matching the existing Perseus Access configuration.

Prefer reusing the existing account-level device serial list/posture rule when it is available in the same Cloudflare Zero Trust account. If the DTXWeb zone is managed in a different Zero Trust account, create an equivalent serial-number list and posture rule using the same intended trusted devices rather than weakening the requirement.

Do not add a Service Auth policy or service token. The protected surfaces are browser routes, and API/desktop non-browser traffic remains outside Access.

## Request Flows

### Production web application

1. Browser requests `https://dtx.hapadona.com/app` or a descendant.
2. Cloudflare Access evaluates identity and device posture.
3. A denied request never reaches DTXWeb.
4. An allowed request reaches SvelteKit.
5. SvelteKit applies the existing Supabase session guard.
6. If the user lacks a Supabase session, SvelteKit redirects to public `/login`.
7. After login, the browser returns to `/app`; the existing Cloudflare Access session allows it through the outer gate again.

Public production routes skip steps 2-3 entirely because they are not part of the Access application.

### Pre-production web application

1. Any request to `pre-prod.dtx.hapadona.com` reaches Cloudflare Access first.
2. After Access succeeds, the existing DTXWeb route and Supabase behavior runs normally.
3. OAuth/login callbacks on the same pre-production hostname remain behind Access, but the browser already has an Access session from entering the site.

### API traffic

Requests to production and pre-production GraphQL API hostnames do not pass through these Access applications. Existing Supabase/API authorization remains unchanged, and desktop/API clients do not need Cloudflare service credentials.

## Repository Changes

The implementation should add one operator runbook documenting:

- the two Access application names and exact destinations;
- policy requirements;
- the public/protected route matrix;
- dashboard setup steps;
- verification commands and browser checks;
- rollback steps;
- the explicit rule that email addresses and device serial numbers must not be committed.

No application or deployment code should change unless implementation verification reveals an existing bug that prevents the approved design. Such a bug is outside this slice and should be handled separately instead of silently expanding scope.

## Verification

Verify from a browser without a current Access session:

- production `/app` prompts for or redirects through Cloudflare Access;
- a production `/app/*` descendant also requires Access;
- production `/`, `/blog`, `/preview`, `/editor`, `/login`, and `/auth/*` do not trigger Cloudflare Access;
- every tested route on `pre-prod.dtx.hapadona.com` requires Access;
- both API hostnames do not trigger Cloudflare Access.

Verify from the allowed identity on the trusted device:

- production `/app` passes Access and continues into the existing Supabase behavior;
- an unauthenticated Supabase session can still go `/app` -> `/login` -> `/app` successfully;
- the production desktop browser-login flow can enter through public `/login` and return through protected `/app`;
- pre-production login and callback flows work after the hostname-wide Access gate;
- public production routes remain usable without a Cloudflare Access session.

Verify from a device that does not satisfy the posture rule that protected production and pre-production surfaces are denied before DTXWeb loads.

## Failure Handling And Rollback

If production public routes become Access-protected, remove the overly broad destination immediately and restore the production application to only `/app` plus `/app/*`.

If pre-production authentication callbacks fail, first confirm the browser retains a valid Access session across the OAuth redirect. Do not make `/auth/*` public on pre-production without a separate design decision; the approved policy is hostname-wide protection.

If API or desktop non-browser traffic begins receiving Access challenges, remove the API hostname from Access. Service-token support is explicitly outside this slice.

Rollback consists of disabling or deleting the two DTXWeb Access applications. No Worker rollback or code deploy should be necessary because the application binaries are unchanged.

## References

- Cloudflare Access application paths: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- Cloudflare self-hosted public applications: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- Cloudflare Access policies: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
- Cloudflare ZTNA policy design and device posture: https://developers.cloudflare.com/reference-architecture/design-guides/designing-ztna-access-policies/
