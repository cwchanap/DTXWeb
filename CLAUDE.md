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

Use `-w={package}` flag to run commands in specific packages:

```bash
# Building (only build common if modified)
npm run build -w=@dtx/common    # Build shared package ONLY if you modified it

# Testing
npm run test -w=dtx-web         # Run web app tests
npm run test -w=dtx-web -- TestFile.test.ts  # Run specific test
npm run test -w=dtx-desktop     # Run desktop app tests
npm run test -w=@dtx/common     # Run common package tests
npm run test -w=@dtx/ui-components  # Run UI components tests

# Type checking
npm run check -w=dtx-web        # TypeScript/Svelte check
npm run check -w=dtx-desktop    # Desktop TypeScript check
npm run typecheck:node -w=dtx-desktop  # Desktop Node.js type check
```

### Project-wide commands

```bash
# Development servers
npm run dev                     # Run both web and desktop dev servers
npm run dev:web                 # Run web app only (port 5173)
npm run dev:desktop             # Run desktop app only
npm run dev:common              # Run common package dev server (port 5175)
npm run dev:all                 # Run all dev servers

# Linting & formatting
npm run lint                    # Check formatting and lint
npm run format                  # Auto-format code

# Building and testing
npm run build                   # Build all packages
npm run test                    # Run tests for all packages
npm run test:coverage           # Run tests with coverage

# Supabase type generation
npm run gen-types              # Generate TypeScript types from Supabase schema

# Clean dependencies
npm run clean                  # Remove all node_modules
```

## Architecture

### Technology Stack

- **Frontend**: Svelte 5 + SvelteKit 2.x + TypeScript 5.x
- **Game Engine**: Phaser 3.88 for rhythm game mechanics
- **Styling**: TailwindCSS 4.x + Skeleton UI components
- **Backend**: Supabase (auth/database) + Cloudflare Workers (API)
- **Desktop**: Electron 35.x with Svelte frontend
- **Build**: Vite 6.x + npm workspaces

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

- `__mocks__/phaser.ts` - Complete Phaser.js mock
- `__mocks__/@dtx/common.ts` - Common package mock
- `__mocks__/svelte/store.ts` - Svelte store mocks

### Testing Commands

- Use workspace-specific: `npm test -w=dtx-web -- TestFile.test.ts`
- Vitest with jsdom environment
- Global mocks auto-loaded

### Unit Testing Approach

- For unit test, only write unit test involving code logic
- Never write trivial test (like testing variable assignment, simple math)

## Code Conventions

### Svelte/TypeScript

- Use early returns for readability
- Prefer `const` over `function`
- Event handlers prefixed with "handle" (e.g., `handleClick`)
- Use `class:` directive over ternary operators in classes
- TypeScript types for all functions/components

### Styling

- Use Skeleton UI components when available
- TailwindCSS utility classes in markup
- No direct CSS/style modifications to base.css
- Dynamic classes with template literals when needed

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

## Environment Setup

- Node.js v22.14.0 (see `.nvmrc`)
- Uses npm workspaces for monorepo management
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
- NEVER run development servers (`npm run dev`) or build commands (`npm run build`) unless the user explicitly instructs you to do so
- ONLY build the shared package (`@dtx/common`) if you have made changes to files within that package

# important-instruction-reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User.
