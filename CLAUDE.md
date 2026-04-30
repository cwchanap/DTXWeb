# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Drumery is a rhythm game platform for DTX (drum simulation) files. It's a monorepo with 4 packages:

- `packages/common` - Shared Svelte component library and DTX file parsing
- `packages/dtx-web` - SvelteKit web application (main app)
- `packages/dtx-desktop` - Electron desktop application
- `packages/ui-components` - Shadcn-Svelte UI component library (export-only components)

## Development Commands

### Package-specific commands

Use `--filter={package}` flag to run commands in specific packages:

```bash
# Building (only build common if modified)
bun run --filter=@dtx/common build    # Build shared package ONLY if you modified it

# Testing
bun run --filter=dtx-web test         # Run web app tests
bun run --filter=dtx-web test -- TestFile.test.ts  # Run specific test
bun run --filter=dtx-desktop test     # Run desktop app tests
bun run --filter=@dtx/common test     # Run common package tests
bun run --filter=@dtx/ui-components test  # Run UI components tests

# Type checking
bun run --filter=dtx-web check        # TypeScript/Svelte check
bun run --filter=dtx-desktop check    # Desktop TypeScript check
bun run --filter=dtx-desktop typecheck:node  # Desktop Node.js type check
```

### Project-wide commands

```bash
# Development servers
bun run dev                     # Run both web and desktop dev servers
bun run dev:web                 # Run web app only (port 5173)
bun run dev:desktop             # Run desktop app only
bun run dev:common              # Run common package dev server (port 5175)
bun run dev:all                 # Run all dev servers

# Linting & formatting
bun run lint                    # Check formatting and lint
bun run format                  # Auto-format code

# Building and testing
bun run build                   # Build all packages
bun run test                    # Run tests for all packages
bun run test:coverage           # Run tests with coverage

# E2E tests (Playwright)
bun run e2e                     # Run all Playwright e2e tests
bun run e2e:ui                  # Run e2e tests in interactive UI mode
bun run fixtures:generate       # Generate MIDI test fixtures for e2e tests
bun run fixtures:verify         # Verify e2e test fixtures are valid

# Deployment (Cloudflare Workers)
bun run deploy:web                       # Deploy web app to production
bun run deploy:web:preprod               # Deploy web app to pre-prod (preprod D1 + R2)
bun run deploy:web:preprod:prod-data     # Deploy web app to pre-prod with prod D1 + R2

# Supabase type generation
bun run gen-types              # Generate TypeScript types from Supabase schema

# Clean dependencies
bun run clean                  # Remove all node_modules
```

## Architecture

### Technology Stack

- **Frontend**: Svelte 5 + SvelteKit 2.x + TypeScript 5.x
- **Game Engine**: Phaser 3.88 for rhythm game mechanics
- **Styling**: TailwindCSS 4.x + Skeleton UI components
- **Backend**: Supabase (auth/database) + Cloudflare Workers (API)
- **Desktop**: Electron 35.x with Svelte frontend
- **Build**: Vite 6.x + bun workspaces

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
- Data inconsistencies after main process updates

### Manual Cache Clearing

If needed, cache can be manually cleared via browser dev tools:

```javascript
// Clear simfile cache only
simFileService.clearCache();

// Or clear specific localStorage items
localStorage.removeItem('simfiles_cache');
localStorage.removeItem('simfiles_cache_timestamp');
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

### Unit Testing Approach

- For unit tests, only write tests involving code logic
- Never write trivial tests (like testing variable assignment, simple math)
- **ALWAYS check the `__mocks__` folder** before creating new mocks for external libraries
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
- **Desktop**: Built with electron-builder, distributed via GitHub releases
- **Worker**: Deployed to Cloudflare Workers
- **Database**: Supabase PostgreSQL with real-time subscriptions
- **Storage**: AWS S3 and Cloudflare R2 for game assets

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
- Uses bun workspaces for monorepo management
- Turborepo for build orchestration and caching
- Uses husky + lint-staged for git hooks
- Prettier for code formatting (tabs, single quotes, width 100)
- ESLint for TypeScript and Svelte linting
- Supabase CLI for type generation and local development

## Code Maintenance

- Remove and clean up unused files and code for refactoring work. Never mark them deprecated.

## Important Instructions for Agents

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User
- NEVER run development servers (`bun run dev`) or build commands (`bun run build`) unless the user explicitly instructs you to do so
- ONLY build the shared package (`@dtx/common`) if you have made changes to files within that package
