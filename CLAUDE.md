# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Drumery is a rhythm game platform for DTX (drum simulation) files. It's a Bun-workspaces monorepo (orchestrated by Turborepo) with 7 packages:

- `packages/common` (`@dtx/common`) - Shared Svelte component library and DTX file parsing
- `packages/dtx-web` (`dtx-web`) - SvelteKit web application (main app), deployed to Cloudflare Workers
- `packages/dtx-desktop` (`dtx-desktop`) - Tauri 2 desktop app: Svelte/Vite frontend (`src/`) + Rust backend (`src-tauri/`)
- `packages/dtx-api` (`dtx-api`) - GraphQL API on Cloudflare Workers (Pothos + GraphQL Yoga), backing both web and desktop
- `packages/ui-components` (`@dtx/ui-components`) - Shadcn-Svelte UI component library (export-only components)
- `packages/e2e-web` (`dtx-e2e-web`) - Playwright end-to-end tests for the web application
- `packages/e2e-desktop` (`dtx-e2e-desktop`) - WebdriverIO/Tauri end-to-end tests for the desktop application

> The desktop app was migrated from Electron to Tauri. References to Electron, the "main process", or `electron-builder` elsewhere in older docs are obsolete — the native layer is now Rust under `src-tauri/`.
>
> `AGENTS.md` (referenced by `README.md` as the contributor guide) is a symlink to this file, so editing `CLAUDE.md` updates both — no manual sync needed. The former `.cursor/rules/*.mdc` files (Electron-era, npm-workspace, 4-package) have been consolidated into this file and removed; trust this file as the single source of truth.

## Development Commands

### Package-specific commands

Use `--filter={package}` flag to run commands in specific packages:

```bash
# Building (only build common if modified)
bun run --filter=@dtx/common build    # Build shared package ONLY if you modified it

# Testing (JS/TS via Vitest)
bun run --filter=dtx-web test         # Run web app tests
bun run --filter=dtx-web test -- TestFile.test.ts  # Run a single test file
bun run --filter=dtx-desktop test     # Run desktop frontend tests
bun run --filter=dtx-api test         # Run API tests
bun run --filter=@dtx/common test     # Run common package tests
bun run --filter=@dtx/ui-components test  # Run UI components tests

# Desktop Rust backend (run from packages/dtx-desktop/src-tauri)
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml      # Rust unit tests
cargo fmt --check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml  # Format check (enforced by pre-commit hook)
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml    # Lints

# Type checking
bun run --filter=dtx-web check        # SvelteKit sync + svelte-check
bun run --filter=dtx-desktop typecheck  # Desktop svelte-check (tsconfig.web.json)
bun run --filter=dtx-api check        # tsc --noEmit

# GraphQL codegen (web client types are generated from the dtx-api schema)
bun run --filter=dtx-web codegen      # Regenerate src/lib/api/generated/ after schema changes
bun run --filter=dtx-api gen-schema   # Regenerate the GraphQL schema from the API
```

> **CI codegen sequence**: `lint-and-format.yml` regenerates the schema before verifying the client — it runs `bun run --filter=dtx-api gen-schema` (step "Generate GraphQL schema") and then `bun run --filter=dtx-web lint:codegen` (step "Verify generated GraphQL client"). `lint:codegen` runs `codegen` and then fails if `src/lib/api/generated/` has uncommitted changes, so when you change the API schema or any GraphQL operation, run `gen-schema` first (writes `packages/dtx-api/dist/schema.graphql`), then `codegen` (writes `packages/dtx-web/src/lib/api/generated/`), and commit both regenerated paths.

### Project-wide commands

```bash
# Development servers
bun run dev                     # Run API (8787) + web (5173) + desktop (Tauri), wired for local
bun run dev:web                 # Run web app only (port 5173)
bun run dev:desktop             # Run desktop app only (tauri dev)
bun run dev:common              # Run common package dev server
bun run dev:all                 # Run all dev servers + common

# Linting & formatting
bun run lint                    # ESLint over .js/.ts/.svelte
bun run format                  # Prettier auto-format (tabs, single quotes, width 100)
bun run check                   # Type-check across packages

# Building and testing
bun run build                   # Build all packages (Turborepo, respects ^build order)
bun run test                    # Run tests for all packages
bun run test:coverage           # Run tests with coverage
bun run test:web | test:desktop | test:common  # Per-package test shortcuts

# E2E tests
bun run e2e                     # Run all web Playwright e2e tests
bun run e2e:web                 # Run all web Playwright e2e tests
bun run e2e:ui                  # Run web e2e tests in interactive UI mode
bun run e2e:desktop             # Build and run the desktop Tauri e2e tests
bun run fixtures:generate       # Generate MIDI test fixtures for e2e tests
bun run fixtures:verify         # Verify e2e test fixtures are valid

# Deployment (Cloudflare Workers) — manual, no CI/CD
bun run deploy:web                       # Deploy web app to production
bun run deploy:web:preprod               # Deploy web app to pre-prod (preprod D1 + R2)
bun run deploy:web:preprod:prod-data     # Deploy web app to pre-prod with prod D1 + R2
bun run deploy:api                       # Deploy GraphQL API to production
bun run deploy:api:preprod               # Deploy API to pre-prod
bun run deploy:api:preprod:prod-data     # Deploy API to pre-prod with prod data

# Supabase type generation
bun run gen-types              # Generate TypeScript types from Supabase schema

# Clean dependencies
bun run clean                  # Remove all node_modules
```

> **E2E note**: `packages/e2e-web/playwright.config.ts` auto-starts its own servers (web on 5173 + API via `wrangler dev`) and seeds a local Supabase stack (`packages/e2e-web/setup/prepare-stack.ts`, `seed.sql`, `global.setup.ts` for auth storage state). Do **not** manually start dev servers before running `bun run e2e` — Playwright manages the full stack. Override the target with `PLAYWRIGHT_BASE_URL`.

> **R2 uploads**: `scripts/cli.py` is a standalone Python (Click + boto3) tool — `python scripts/cli.py upload_r2 <file> [<bucket>:<path>]` — for pushing assets to Cloudflare R2. It is independent of the Bun workspace: `pip install -r scripts/requirements.txt` and set `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ACCESS_KEY_ID` / `CLOUDFLARE_ACCESS_KEY_SECRET` in `.env`.

## Architecture

### Technology Stack

- **Frontend**: Svelte 5 + SvelteKit 2.x + TypeScript 5.x
- **Game Engine**: Phaser 3.88 for rhythm game mechanics
- **Styling**: TailwindCSS 4.x + Skeleton UI components
- **API**: `dtx-api` — GraphQL on Cloudflare Workers (Pothos schema-builder + GraphQL Yoga); web client types generated via graphql-codegen
- **Backend services**: Supabase (auth/database), Cloudflare D1 + R2 (simfile storage)
- **Desktop**: Tauri 2 — Svelte/Vite webview frontend + Rust backend (`src-tauri/`), Rust 1.95 / edition 2021
- **Build**: Vite 6.x + Bun workspaces + Turborepo

### DTX File Processing

The core of the application is DTX file parsing and gameplay:

- `DTXFile` class handles parsing DTX drum chart files
- `SimFile` manages sound chips and measure-based note timing
- Phaser scenes: MainMenu → Editor → Preview → BaseGame
- Audio processing via xa_decoder for various audio formats

### Package Dependencies

**Build order matters**: Only build `@dtx/common` if you made changes to it, as other packages depend on it.

The common package exports:

- Svelte components via `./components` export
- Types and utilities via main export
- Game-related exports via `./game` export
- Server utilities via `./server` export
- DTX file parsing classes (`DTXFile`, `SimFile`, `LaneMeasureNote`, `SoundChip`)

The ui-components package exports:

- Shadcn-Svelte UI components via main export and `./components` export
- Built with Tailwind CSS variants and utilities

### GraphQL API (`dtx-api`)

- A Cloudflare Worker exposing a GraphQL endpoint via GraphQL Yoga; the schema is built code-first with Pothos (`schema/`), backed by `services/` (Supabase + D1/R2) and `rest/` handlers.
- Auth uses Pothos scope-auth; requests carry Supabase session context (`context.ts`).
- The web client consumes it through generated typed documents: edit a GraphQL operation, then run the web `codegen` script to refresh `src/lib/api/generated/`. `lint:codegen` fails CI if generated output is stale, so commit regenerated files.
- Local dev runs on port `8787` (`dtx-api#dev:local`); web/desktop point at it via `VITE_DTX_API_URL` / `PUBLIC_DTX_API_URL`.

### Desktop (Tauri) Backend

- Native logic lives in Rust under `packages/dtx-desktop/src-tauri/src/`: `api.rs` (API calls), `auth.rs` (deep-link OAuth callback; loopback port is configurable via `DTX_DESKTOP_AUTH_CALLBACK_PORT`, defaulting to `47931` in the local-dev scripts), `filesystem.rs` (workspace file access), `songs.rs`, `updater.rs`, `models.rs`, `error.rs`. Commands are exposed to the Svelte frontend via Tauri's IPC.
- The frontend calls Rust commands through `@tauri-apps/api`; capabilities/permissions are declared in `src-tauri/capabilities/` and `tauri.conf.json`.
- Rust tests live in `src-tauri/src/tests/` (use `wiremock` for HTTP, `tempfile` for fs). `cargo fmt --check` is enforced by the pre-commit hook for staged `.rs` files.
- `tauri build` only bundles for the host OS (`build:mac` / `build:win`); cross-OS builds must run on the target OS.

### File Structure Patterns

- Use `$lib/` aliases for imports within packages
- Shared types in `@dtx/common`
- Game scenes in `src/lib/game/scenes/`
- Components in `src/lib/components/`

## Cache Management

### Desktop Cache Clearing

The desktop app has a "Clear Cache" button in the navigation bar (when authenticated) that clears:

- SimFile cache (5-minute cached simfile data from Supabase)
- Template cache (user-created song templates)

**Important**: The cache clear button preserves:

- Authentication session (user stays logged in)
- Workspace path (current workspace directory)

### When to Clear Cache

Clear cache when:

- Level labels are missing after database schema changes
- Stale simfile data is displayed
- Template changes aren't reflected
- Data inconsistencies after Rust backend / API updates

### Manual Cache Clearing

If needed, cache can be manually cleared via browser dev tools:

```javascript
// Clear simfile cache only
simFileService.clearCache();

// Or clear specific localStorage items
localStorage.removeItem('simfiles_cache_v2');
localStorage.removeItem('simfiles_cache_timestamp_v2');
localStorage.removeItem('dtx_linkage_cache_v2');
localStorage.removeItem('song_templates');

// DO NOT clear these (breaks auth/workspace)
// localStorage.removeItem('workspace_path');
// localStorage.removeItem('auth_session');
```

## Testing

### Global Mocks

Check `__mocks__/` folder before creating new mocks:

- `__mocks__/phaser.ts` - Complete Phaser.js mock with Scene, GameObjects, Sound, etc.
- `__mocks__/EventBus.ts` - Event bus system mock
- `__mocks__/audioDecoder.ts` - Audio decoder functionality mock
- `__mocks__/svelte-i18n.ts` - Internationalization mock

### Testing Commands

- Use workspace-specific: `bun run --filter=dtx-web test -- TestFile.test.ts`
- Vitest with jsdom environment
- Global mocks auto-loaded

### Affected CI matrix

Pull requests keep the required unit and lint workflows present; affected scope
only gates their expensive steps. The expected validation matrix is:

| Change               | Unit | ESLint/Prettier | Heavy lint | Web E2E | Desktop E2E | Rust CI | Packaging | CodeQL |
| -------------------- | ---- | --------------- | ---------- | ------- | ----------- | ------- | --------- | ------ |
| docs only            | skip | run             | skip       | skip    | skip        | skip    | skip      | skip   |
| web/API              | run  | run             | run        | run     | skip        | skip    | skip      | JS/TS  |
| common/ui            | run  | run             | run        | run     | run         | skip    | skip      | JS/TS  |
| desktop renderer     | run  | run             | run        | skip    | run         | run     | skip      | JS/TS  |
| desktop Rust         | run  | run             | run        | skip    | run         | run     | skip      | Rust   |
| `tsconfig.base.json` | run  | run             | run        | run     | run         | skip    | skip      | JS/TS  |

The required `test` context belongs to the unit workflow; Playwright publishes
the `playwright` context. Required workflows are never event-level path-skipped.
If affected-scope detection is uncertain, unit and lint run more validation and
CodeQL analyzes all languages. Codecov upload transport is informational by
HPA-613 design. Risky desktop packaging changes can be exercised with
`workflow_dispatch` before merge; normal PR packaging is intentionally absent.
CodeQL uses `build-mode: none`, runs all languages on `main` pushes and scheduled
scans, and conservatively selects mapped languages for pull requests.

### Unit Testing Approach

- For unit tests, only write tests involving code logic
- Never write trivial tests (like testing variable assignment, simple math)
- **ALWAYS check the `__mocks__` folder** before creating new mocks for external libraries
- Prefer mocking dependencies over installing additional test packages
- Enhance global mocks rather than creating local ones when possible; use local mocks only for project-specific modules or one-off test-specific behavior
- Use `Preview.test.ts` as the reference pattern for test structure (beforeEach/afterEach setup, vi.mock at the top)
- Use workspace-specific test commands for individual packages

## Code Conventions

### Svelte/TypeScript

- Use early returns for readability
- Prefer `const` over `function`
- Event handlers prefixed with "handle" (e.g., `handleClick`)
- Use `class:` directive over ternary operators in classes
- TypeScript types for all functions/components

### Accessibility

Interactive elements (non-button tags with click handlers) must include `tabindex="0"`, `aria-label`, and `on:keydown` alongside `on:click`.

### Styling

- Use Skeleton UI (3.x) components when available
- TailwindCSS utility classes in markup
- No direct CSS/style modifications to base.css
- Dynamic classes with template literals when needed
- For complex components, use `@apply` in a scoped `<style>` block rather than long inline class strings

### Import Patterns

```typescript
// Aliased imports
import Component from '$lib/components/Component.svelte';
import { util } from '$lib/utils';

// Cross-package imports
import { DTXFile } from '@dtx/common';
import { Button } from '@dtx/common/components';
```

### Import Recommendations

- Always using top level imports whenever possible
- Avoid relative paths for cross-package imports
- For internal components, use `$lib/` alias instead of relative paths
- For external libraries, use absolute import paths

## Deployment & Infrastructure

- **Web App**: Deployed to Cloudflare Workers via @sveltejs/adapter-cloudflare
- **GraphQL API** (`dtx-api`): Deployed to Cloudflare Workers via wrangler (`deploy:api*`)
- **Desktop**: Built with Tauri (`tauri build`), with auto-update via `tauri-plugin-updater`; distributed via GitHub releases (`desktop-build-deploy.yml`)
- **Database**: Supabase PostgreSQL + Cloudflare D1
- **Storage**: Cloudflare R2 (and AWS S3) for game assets

### Deployment Environments

Three environments are configured in `packages/dtx-web/wrangler.jsonc`:

| Command                                | Domain                      | D1 Database       | R2 Bucket             | Use Case                           |
| -------------------------------------- | --------------------------- | ----------------- | --------------------- | ---------------------------------- |
| `bun run deploy:web`                   | `dtx.hapadona.com`          | `dtx-web` (prod)  | `simfile-dtx` (prod)  | Production releases                |
| `bun run deploy:web:preprod`           | `pre-prod.dtx.hapadona.com` | `dtx-web-preprod` | `simfile-dtx-preprod` | Testing with isolated data         |
| `bun run deploy:web:preprod:prod-data` | `pre-prod.dtx.hapadona.com` | `dtx-web` (prod)  | `simfile-dtx` (prod)  | Testing new code against real data |

All commands build first (`vite build`) then deploy via `wrangler deploy` with the appropriate `--env` flag. Web deploys are manual (no CI/CD pipeline).

### R2 Bucket Configuration

Production and pre-production have separate R2 buckets (`simfile-dtx` and `simfile-dtx-preprod`) and separate D1 databases (`dtx-web` and `dtx-web-preprod`) for complete environment isolation.

## Environment Setup

- Node.js 22.x or later
- Bun v1.3.9 (package manager and runtime)
- Rust 1.77+ toolchain (required to build/test the desktop `src-tauri` backend)
- Uses bun workspaces for monorepo management
- Turborepo for build orchestration and caching
- Uses husky + lint-staged for git hooks (lint-staged + `cargo fmt --check` on staged Rust files)
- Prettier for code formatting (tabs, single quotes, width 100)
- ESLint for TypeScript and Svelte linting
- Supabase CLI for type generation and local development
- CI (`.github/workflows/`) includes required `lint-and-format` and `unit-test` workflows, plus path-filtered pull-request checks for web/desktop E2E, Rust, and CodeQL. `desktop-build-deploy` runs only on `preview`/`main` pushes, version tags, or `workflow_dispatch`. Worker deploys are manual.

## Code Maintenance

- Remove and clean up unused files and code for refactoring work. Never mark them deprecated.

## Important Instructions for Agents

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User
- NEVER run development servers (`bun run dev`) or build commands (`bun run build`) unless the user explicitly instructs you to do so
- ONLY build the shared package (`@dtx/common`) if you have made changes to files within that package
