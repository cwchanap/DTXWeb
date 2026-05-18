# dtx-api

Cloudflare Worker that hosts the project's GraphQL API at `api.dtx.hapadona.com`.

- `POST /graphql` — Yoga + Pothos schema
- `GET /graphql` — GraphiQL playground (pre-prod only, `GRAPHIQL=true`)
- `GET /healthz` — liveness probe

See `docs/superpowers/specs/2026-05-16-api-server-migration-design.md` for the parent design.
