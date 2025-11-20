# Repository Guidelines

## Project Structure & Module Organization

The Turborepo contains four workspaces: `packages/dtx-web` (SvelteKit UI), `packages/dtx-desktop` (Electron shell), `packages/common` (shared TypeScript logic), and `packages/ui-components` (design system). Shared assets live in `skin/`/`sample/`. Tests sit beside code; e2e flows run from `e2e/`, migrations live in `supabase/`, and automation scripts reside in `scripts/`.

## Build, Test & Development Commands

- `npm run dev:web` / `npm run dev:desktop` – start the web or desktop hot reloader.
- `npm run dev:all` – spin up both apps plus shared packages when working on cross-surface APIs.
- `npm run build` – run every workspace build through Turbo (Vite, electron-vite, shared libs).
- `npm run lint` / `npm run check` – enforce ESLint, svelte-check, and TS project references.
- `npm run test` / `npm run test:coverage` – execute Vitest suites repository-wide with optional coverage.
- `npm run e2e` – run Playwright specs in `e2e/`; refresh MIDI fixtures with `npm run fixtures:generate` when assets change.

## Coding Style & Naming Conventions

TypeScript/Svelte files follow Prettier 3 defaults enforced via `npm run format:root` and `lint-staged`. ESLint (`@typescript-eslint`, `eslint-plugin-svelte`) must pass—avoid blanket disables. Components stay PascalCase, stores/services camelCase, tests mirror the subject (`Widget.test.ts`), and shared utilities should use named exports. Co-locate styling with components and hide platform differences inside adapters under `packages/common`.

## Testing Guidelines

Vitest plus Testing Library power unit/component suites; colocate specs and stick to the `*.test.ts` suffix for auto-discovery. Cover happy paths, edge inputs, and timezone math when working with `dayjs`. Run the package-specific coverage scripts before review and keep each workspace ≥80% line coverage. Use Playwright for workflow coverage (uploads, Supabase sync, Phaser playback) and tag long scenarios with `@slow` to skip via `npx playwright test --grep-invert @slow`.

## Commit & Pull Request Guidelines

Follow Conventional Commits (`type(scope): summary`), mirroring history such as `feat(web): update UI components and page layouts`. Keep commits focused and include required fixture or schema updates. PRs need a summary, linked issue, validation checklist (`npm run test:coverage`, `npm run e2e`), and screenshots for UI tweaks. Call out migrations or new env vars so reviewers can prepare environments.

## Security & Configuration Tips

Keep secrets in the root `.env`, which each workspace symlinks via its `prepare` script; never commit generated keys or Supabase service roles. Validate Cloudflare bindings or Supabase typings with `npm run gen-types` before deploying, and refresh `supabase/.env.example` whenever new configuration knobs are introduced.
