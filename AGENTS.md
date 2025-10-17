# Repository Guidelines

## Project Structure & Module Organization
This Turbo-powered monorepo keeps deliverables in `packages/`. Use `packages/dtx-web` for the SvelteKit web client, `packages/dtx-desktop` for the Electron build, `packages/common` for shared logic, and `packages/ui-components` for reusable Svelte UI primitives. End-to-end scenarios and Playwright fixtures live under `e2e/`, while infrastructure scripts and automation helpers sit in `scripts/`. Shared configs (`tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`) in the repo root cascade to every workspace.

## Build, Test, and Development Commands
Run `npm install` once, then use the workspace-aware scripts in `package.json`. `npm run dev` spins up both web and desktop targets; scope to one surface with `npm run dev:web` or `npm run dev:desktop`. Ship artifacts via `npm run build`, which triggers Turbo builds across every package. Execute unit suites with `npm test` (Vitest in each workspace) and collect coverage using `npm run test:coverage`. Front-to-back validation lives in `npm run e2e`; launch the Playwright inspector with `npm run e2e:ui`. Use `npm run lint`, `npm run format`, and `npm run check` before opening a pull request to catch typing, lint, and formatting regressions.

## Coding Style & Naming Conventions
TypeScript and Svelte files use tabs, 4-space EditorConfig fallback, and a 100-character width enforced by Prettier. Favor PascalCase for Svelte components, camelCase for functions and variables, and kebab-case for file names inside routes (for example, `src/routes/editor-session/+page.svelte`). ESLint combines `@typescript-eslint`, `svelte`, and `unused-imports` rules—avoid disabling them unless the violation is genuinely intentional. Tailwind utility order is auto-managed via `prettier-plugin-tailwindcss`; run the formatter on staged changes (`npx lint-staged`) to keep diffs minimal.

## Testing Guidelines
Author Vitest specs next to the code they cover (for example, `src/lib/foo.test.ts`). Use descriptive `describe` scopes that mirror feature names and prefer `it('renders playback controls')` style titles. Capture new behaviors with snapshot or DOM assertions via Testing Library. Maintain ≥80 % coverage in changed modules before merging. For e2e additions, drop scenarios under `e2e/tests/` and regenerate MIDI fixtures with `npm run fixtures:generate`; validate them via `npm run fixtures:verify`.

## Commit & Pull Request Guidelines
Follow the conventional commit style observed in history (`feat:`, `fix:`, `refactor:`). Keep messages scoped to a single concern and mention the package when helpful (`feat(web): add playlist toolbar)`). Pull requests should include: a concise summary, linked Jira/GitHub issue, test evidence (`npm test`, `npm run e2e` when relevant), and before/after screenshots for UI-facing changes. Mark breaking changes clearly and request reviews from the owning package team (web, desktop, or shared) before merging.
