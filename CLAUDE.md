# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Drumery is a rhythm game platform for DTX (drum simulation) files. It's a monorepo with 3 packages:

- `packages/common` - Shared Svelte component library and DTX file parsing
- `packages/dtx-web` - SvelteKit web application (main app)
- `packages/dtx-desktop` - Electron desktop application

## Development Commands

### Package-specific commands

Use `-w={package}` flag to run commands in specific packages:

```bash
# Building (only build common if modified)
npm run build -w=@dtx/common    # Build shared package ONLY if you modified it

# Testing
npm run test -w=dtx-web         # Run web app tests
npm run test -w=dtx-web -- TestFile.test.ts  # Run specific test

# Type checking
npm run check -w=dtx-web        # TypeScript/Svelte check
```

### Project-wide commands

```bash
# Linting & formatting
npm run lint                    # Check formatting and lint
npm run format                  # Auto-format code

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
- DTX file parsing classes (`DTXFile`, `SimFile`, `LaneMeasureNote`, `SoundChip`)

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

**ALWAYS check `__mocks__/` folder first** before creating new mocks:

- `__mocks__/phaser.ts` - Complete Phaser.js mock
- `__mocks__/@dtx/common.ts` - Common package mock
- `__mocks__/svelte/store.ts` - Svelte store mocks

### Mock Strategy

- Prefer mocking dependencies over installing additional test packages
- Enhance existing global mocks rather than creating local ones
- Use global mocks for external libraries and common dependencies
- Use local mocks only for project-specific modules

### Testing Commands

```bash
# Root-level test shortcuts
npm run test:web              # Run web app tests
npm run test:desktop          # Run desktop app tests
npm run test:common           # Run common package tests
npm run test:coverage:web     # Run web tests with coverage

# Workspace-specific (more flexible)
npm run test -w=dtx-web -- TestFile.test.ts  # Run specific test
npm run test:watch -w=dtx-web                # Watch mode
```

- Vitest with jsdom environment
- Global mocks auto-loaded

## Code Conventions

### Svelte/TypeScript

- Use early returns for readability
- Prefer `const` over `function` declarations
- Event handlers prefixed with "handle" (e.g., `handleClick`)
- Use `class:` directive over ternary operators in classes
- Define TypeScript types for all functions/components
- Follow DRY principles and write bug-free, fully functional code
- Prioritize readable code over performance optimizations
- Implement proper accessibility (tabindex, aria-label, keyboard events)

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

## Deployment & Infrastructure

- **Web App**: Deployed to Cloudflare Workers via @sveltejs/adapter-cloudflare
- **Desktop**: Built with electron-builder, distributed via GitHub releases
- **Worker**: Deployed to Cloudflare Workers
- **Database**: Supabase PostgreSQL with real-time subscriptions
- **Storage**: AWS S3 and Cloudflare R2 for game assets

## Environment Setup

- Node.js 22.x or later required
- Uses husky + lint-staged for git hooks
- Supabase CLI for type generation and local development

## Important Instructions for Agents

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User
- NEVER run development servers (`npm run dev`) or build commands (`npm run build`) unless the user explicitly instructs you to do so
- ONLY build the shared package (`@dtx/common`) if you have made changes to files within that package
