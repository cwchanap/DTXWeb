# Copilot Instructions for Drumery

## Project Overview

Drumery is a rhythm game platform for DTX (drum simulation) files. It's a monorepo with 4 packages using npm workspaces:

- `@dtx/common` - Shared Svelte component library and DTX file parsing
- `dtx-web` - SvelteKit web application (main app)
- `dtx-desktop` - Electron desktop application

## Technology Stack

- **Frontend**: Svelte 5 + SvelteKit 2.x + TypeScript 5.x
- **Game Engine**: Phaser 3.88 for rhythm game mechanics
- **Styling**: TailwindCSS 4.x + Skeleton UI components
- **Backend**: Supabase (auth/database) + Cloudflare Workers
- **Desktop**: Electron 35.x
- **Build**: Vite 6.x + npm workspaces
- **Node.js**: 22.x or later required

## Development Commands

Use workspace flags for package-specific commands:

```bash
# Building (only if you made changes to @dtx/common)
npm run build -w=@dtx/common    # Build shared package when modified

# Testing
npm run test -w=dtx-web         # Run web app tests
npm run test -w=dtx-web -- TestFile.test.ts  # Run specific test
```

**Important**: Do NOT run dev servers (`npm run dev`) or build commands unless explicitly requested by the user.

## Code Conventions

### Svelte/TypeScript

- Use early returns for readability
- Prefer `const` over `function` declarations
- Event handlers prefixed with "handle" (e.g., `handleClick`)
- Use `class:` directive over ternary operators in classes
- Define TypeScript types for all functions/components
- Use aliased imports: `import Component from '$lib/components/Component.svelte'`

### Styling

- Use Skeleton UI components when available
- Use TailwindCSS utility classes directly in markup
- NO direct modifications to base.css
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

## Testing Guidelines

### Global Mocks

- **ALWAYS check `__mocks__/` folder first** before creating new mocks
- Available global mocks: `phaser.ts`, `@dtx/common.ts`, `svelte/store.ts`, etc.
- Enhance existing global mocks rather than creating local ones
- Use workspace-specific test commands with Vitest + jsdom

### Mock Strategy

- Prefer mocking dependencies over installing additional test packages
- Use global mocks for external libraries and common dependencies
- Use local mocks only for project-specific modules

## Architecture Notes

### Build Dependencies

- **Critical**: Only build `@dtx/common` if you made changes to it, as other packages depend on it
- The common package exports components via `./components` and main utilities

### DTX File Processing

- Core classes: `DTXFile`, `SimFile`, `LaneMeasureNote`, `SoundChip`
- Game scenes: MainMenu → Editor → Preview → BaseGame
- Audio processing via xa_decoder

### File Structure

- Use `$lib/` aliases for imports within packages
- Shared types in `@dtx/common`
- Game scenes in `src/lib/game/scenes/`
- Components in `src/lib/components/`

## Best Practices

1. Follow DRY principles and write bug-free, fully functional code
2. Prioritize readable code over performance optimizations
3. Implement proper accessibility (tabindex, aria-label, keyboard events)
4. Use Chain of Thought: outline pseudocode plan → confirm → implement
5. Always include required imports and proper component naming
6. Maintain consistency with existing patterns in the codebase
