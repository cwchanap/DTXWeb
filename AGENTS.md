# Repository Guidelines

## Project Structure & Modules

- Monorepo with npm workspaces under `packages/`:
    - `packages/dtx-web`: SvelteKit web app (Vite).
    - `packages/dtx-desktop`: Electron app (electron-vite).
    - `packages/common`: Shared Svelte components, utilities, DTX parsing.
    - `packages/ui-components`: Shadcn-Svelte UI library (export-only components).
- E2E tests live in `e2e/` (Playwright). Reports: `playwright-report/`.
- Utilities: `scripts/`, `.husky/` pre-commit, `.env.example` for config.

## Build, Test, and Dev

- Install deps: `npm i` (Node `v22.14.0`, see `.nvmrc`).
- Web dev: `npm run dev -w=dtx-web` (Vite on `:5173`).
- Desktop dev: `npm run dev -w=dtx-desktop` (Electron app).
- Build any workspace: `npm run build -w=<workspace>` (e.g., `@dtx/common`, `@dtx/ui-components`).
- Unit tests: `npm run test -w=<workspace>`; coverage: `npm run test:coverage -w=<workspace>`.
- E2E: `npx playwright test` (spins up web via `dtx-web` dev).
- Lint/Format: `npm run lint` / `npm run format`.

## Style & Conventions

- Stack: TypeScript, Svelte 5, Tailwind CSS 4.
- Formatting: Prettier (tabs, single quotes, width 100). Run `npm run format`.
- Linting: ESLint (TS + Svelte). Run `npm run lint`.
- Naming: tests `*.test.ts|*.spec.ts`; components under `src/lib/components/`.

## Testing

- Unit: Vitest (+ Testing Library for Svelte). Keep tests near source or under `src/`.
- Coverage: use `test:coverage`; exclude `dist/`.
- E2E: Playwright specs in `e2e/*.spec.ts`. Ensure no dev server occupies required ports.

## Commits & PRs

- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`). Scope changes clearly.
- PRs: include description, linked issues, test plan, and UI screenshots/screencasts.
- Checks: `lint`, `test`, and builds must pass for all touched workspaces.

## Security & Config

- Never commit secrets. Copy `.env.example` → `.env` where needed (workspaces symlink root `.env`).
- Cloudflare Workers (web) and Supabase require valid env vars before deploy.
