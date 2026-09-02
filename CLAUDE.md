# Sideload

Free, MIT-licensed web service that moves a Spotify library (playlists, liked songs, saved albums, followed artists) to YouTube Music. One Cloudflare Worker (Hono) serves the API and the static Astro site; each transfer is a SQLite Durable Object driven by alarms, so a job survives crashes and resumes for free. Users bring their own Spotify Client ID (PKCE, no secret); YouTube Music is written through InnerTube with a Google "TV and Limited Input devices" OAuth client (device-code flow). The visual/copy spec is `docs/design/handoff.md` + `docs/design/sideload-final.dc.html`.

## Repo rules

- **pnpm** only (`pnpm-workspace.yaml`: `worker`, `web`). Node 22 (`.nvmrc`; wrangler 4 needs ≥ 22). `allowBuilds` in `pnpm-workspace.yaml` approves `esbuild`/`workerd` postinstalls.
- `docs/superpowers/` is gitignored: local planning material. Never commit it and never reference it from code, docs or commit messages.
- No AI attribution anywhere: no `Co-Authored-By`, no tool names in commits, authors or docs.
- One commit per task, conventional prefixes (`feat(worker):`, `chore:`, `docs:`, `ci:`). Keep `pnpm test` and `pnpm --filter worker typecheck` green at every commit.
- Secrets live in `.dev.vars` (gitignored, copy `.dev.vars.example`) locally and in `wrangler secret` in production. Never in `wrangler.jsonc`.
- Each package has its own `CLAUDE.md` with the conventions for that path; update it at the end of any phase that touches the package.

## Commands

```
pnpm install                      # once; needs Node 22
pnpm test                         # all workspaces (worker runs inside workerd)
pnpm --filter worker test         # worker only; `pnpm --filter worker exec vitest run test/x.test.ts -t "name"` for one case
pnpm --filter worker typecheck
pnpm dev                          # wrangler dev on 8787 + astro dev on 4321 (once web/ exists)
pnpm dev:worker                   # worker alone: curl -si http://127.0.0.1:8787/api/stats
pnpm deploy                       # build site, wrangler deploy (CI does this on main)
```

## Layout

- `worker/` — the Worker: routes, OAuth, InnerTube client, matcher, JobDO/StatsDO. See `worker/CLAUDE.md`.
- `web/` — Astro static site + Preact islands (not started yet). Will get its own `CLAUDE.md`.
- `shared/types.ts` — DTOs shared by worker and web; no runtime code.
- `wrangler.jsonc` — single Worker config: assets (`run_worker_first`), DOs (`JobDO`, `StatsDO`, SQLite migration `v1`), KV `MATCH_CACHE`, rate-limit bindings `RL_*`, `PUBLIC_ORIGIN` var.
- `.github/workflows/` — `ci.yml` (PR + main: install, build web, typecheck, test), `deploy.yml` (main → `wrangler deploy`; needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` repo secrets).
- `SECURITY.md` — reporting policy + the pre-launch checklist. `README.md` — user-facing intro + operator runbook.

## Accounts and external constraints (verified 2026-09-02)

- Spotify Development Mode apps are capped at 5 users per Client ID and the owner needs Premium → every user brings their own Client ID. Redirect URI must use `127.0.0.1`, not `localhost`.
- YouTube Data API v3 quota makes the official API useless (100 units per search) → InnerTube. Web-client OAuth tokens are rejected by InnerTube; only the TV-client type works.
- Google sensitive-scope verification is a launch blocker: unverified apps have a lifetime 100-user cap. Do not publish the URL before it is granted.
- Cloudflare: Workers Paid plan, KV namespace (`pnpm wrangler kv namespace create MATCH_CACHE` → id into `wrangler.jsonc`), custom domain, Workers Logs on.

## Status

Worker complete and tested (49 tests) against **synthetic fixtures** shaped from the API docs / ytmusicapi. Before launch: run `worker/scripts/spike-innertube.ts` and `worker/scripts/spike-spotify.ts` with real credentials to record real fixtures (they overwrite `worker/test/fixtures/*.json`; redact afterwards, see `worker/CLAUDE.md`), then run the matcher calibration (`worker/scripts/calibrate-match.ts`, to be written with the real token). Web (Part B) not started.
