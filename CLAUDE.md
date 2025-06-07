# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Drumery is a rhythm game platform for DTX (drum simulation) files. It's a monorepo with 4 packages:

- `packages/common` - Shared Svelte component library and DTX file parsing
- `packages/dtx-web` - SvelteKit web application (main app)
- `packages/dtx-desktop` - Electron desktop application
- `packages/worker` - Cloudflare Worker API services

## Development Commands

### Package-specific commands

Use `-w={package}` flag to run commands in specific packages:

```bash
# Development
npm run dev -w=dtx-web          # Start web dev server
npm run dev -w=dtx-desktop      # Start Electron app

# Building (build common first)
npm run build -w=@dtx/common    # Build shared package first
npm run build -w=dtx-web        # Build web app
npm run build -w=dtx-desktop    # Build desktop app

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

**Build order matters**: Always build `@dtx/common` first as other packages depend on it.

The common package exports:

- Svelte components via `./components` export
- Types and utilities via main export
- DTX file parsing classes (`DTXFile`, `SimFile`, `LaneMeasureNote`, `SoundChip`)

### File Structure Patterns

- Use `$lib/` aliases for imports within packages
- Shared types in `@dtx/common`
- Game scenes in `src/lib/game/scenes/`
- Components in `src/lib/components/`

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

## Deployment & Infrastructure

- **Web App**: Deployed to Vercel via @sveltejs/adapter-vercel
- **Desktop**: Built with electron-builder, distributed via GitHub releases
- **Worker**: Deployed to Cloudflare Workers
- **Database**: Supabase PostgreSQL with real-time subscriptions
- **Storage**: AWS S3 and Cloudflare R2 for game assets

## Environment Setup

- Node.js 22.x or later required
- Uses husky + lint-staged for git hooks
- Supabase CLI for type generation and local development
