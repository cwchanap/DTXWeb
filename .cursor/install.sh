#!/usr/bin/env bash
# Cloud Agent bootstrap for the Drumery monorepo.
# Idempotent: safe to run repeatedly and against a warm snapshot.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# The base image ships Node (>=22.18, with TypeScript type-stripping) and the
# Rust toolchain, but not Bun. Bun is the package manager and runtime for this
# repo, so install the pinned version when it is missing.
BUN_VERSION="1.3.9"
if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null)" != "$BUN_VERSION" ]; then
	curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
fi
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

# Local development secrets/config (.env is gitignored). Seed it from the
# committed example so the API dev server has values to run against.
if [ ! -f .env ]; then
	cp .env.example .env
fi

# Install all workspace dependencies from the committed lockfile.
bun install --frozen-lockfile

# @dtx/ui-components and @dtx/common are consumed by the other packages through
# their built dist/ exports (and their generated type declarations), so build
# them once here. Other packages are built on demand.
bun run --filter=@dtx/ui-components build
bun run --filter=@dtx/common build

# Prepare the local (Miniflare) D1 database for the API so a local
# `wrangler dev` serves real queries. Idempotent: wrangler skips applied
# migrations.
(cd packages/dtx-api && bunx wrangler d1 migrations apply dtx-web --local)
