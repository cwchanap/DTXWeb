# Repository Guidelines

## Project Structure & Module Organization

- Monorepo using npm workspaces under `packages/`:
    - `packages/dtx-web`: SvelteKit web app (Vite).
    - `packages/dtx-desktop`: Electron app (electron-vite).
    - `packages/common`: Shared Svelte components, utilities, DTX parsing.
- End-to-end tests: `e2e/` (Playwright). Reports in `playwright-report/`.
- Misc: `scripts/` for tools, `.husky/` pre-commit, `.env.example` for config.

## Build, Test, and Development Commands

- Install: `npm i` (Node `v22.14.0`, see `.nvmrc`).
- Web dev: `npm run dev -w=dtx-web` → starts Vite on `:5173`.
- Desktop dev: `npm run dev -w=dtx-desktop` → launches Electron.
- Build packages: `npm run build -w=@dtx/common|dtx-web|dtx-desktop`.
- Tests (unit): `npm run test -w=dtx-web|dtx-desktop|@dtx/common`.
- Coverage: `npm run test:coverage -w=…`.
- E2E: `npx playwright test` (uses `e2e/`, spins up web via `npm run dev -w=dtx-web`).
- Lint: `npm run lint` | Format: `npm run format`.
- Generate Supabase types: `npm run gen-types`.

## Coding Style & Naming Conventions

- Languages: TypeScript, Svelte 5, TailwindCSS 4.
- Formatting: Prettier is source of truth (tabs, single quotes, width 100). Run `npm run format`.
- Linting: ESLint with TypeScript + Svelte rules; CI/dev use `npm run lint`.
- Files: tests `*.test.ts` or `*.spec.ts`; components in `src/lib/components/`; game code in `src/lib/game/`.

## Testing Guidelines

- Framework: Vitest (+ Testing Library for Svelte). Keep tests near source or under `src/`.
- Coverage: use `test:coverage` scripts; exclude compiled output (`dist/`).
- E2E: Playwright specs in `e2e/*.spec.ts`. Ensure web dev server isn’t already bound to the port when running.

## Commit & Pull Request Guidelines

- Commits: follow Conventional Commits (`feat:`, `fix:`, `chore:`). Keep changes scoped and clear.
- PRs: include description, linked issues, test plan, and screenshots/screencasts for UI changes.
- Checks: ensure `lint`, `test`, and builds pass for all touched workspaces.

## Security & Configuration Tips

- Do not commit secrets. Copy `.env.example` to `.env` in each workspace as needed (workspace `prepare` scripts symlink root `.env`).
- Cloudflare Workers (web) and Supabase require valid environment variables before deploy.
