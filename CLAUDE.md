# Sideload

Free, MIT-licensed web service that moves a Spotify library (playlists, liked songs, saved albums, followed artists) to YouTube Music. One Cloudflare Worker (Hono) serves the API and the static Astro site; each transfer is a SQLite Durable Object driven by alarms, so a job survives crashes and resumes for free. Users bring their own Spotify Client ID (PKCE, no secret). YouTube side, verified live 2026-09-02: searches are anonymous InnerTube (`WEB_REMIX`), adds/likes/subscribes go through InnerTube `TVHTML5` with a Google "TV and Limited Input devices" OAuth token (device-code flow; the only InnerTube client that accepts it), playlist creation and read-back verification go through the YouTube Data API v3 (50 units per playlist, 1 unit per 50 items read). The visual/copy spec is `docs/design/handoff.md` + `docs/design/sideload-final.dc.html`.

## Repo rules

- **pnpm** only (`pnpm-workspace.yaml`: `worker`, `web`). Node 22 (`.nvmrc`; wrangler 4 needs ≥ 22). `allowBuilds` in `pnpm-workspace.yaml` approves `esbuild`/`workerd` postinstalls.
- Everything under `docs/` except `docs/design/` is gitignored: local planning material lives there. Never commit it and never reference it from code, docs or commit messages.
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
- YouTube Data API v3 quota (10k units/day, 100 per search, 50 per insert) rules it out for search and item adds → InnerTube for those. OAuth tokens are rejected by InnerTube's music/web/android clients (400) and accepted only by `TVHTML5`, which cannot create playlists → `playlists.insert` on the Data API (50 units; ~200 playlists/day until a quota increase is granted, request it with verification).
- Google's abuse page (403 HTML "Sorry…") shows up after request bursts from one IP; the client treats it as a throttle and backs off.
- Google sensitive-scope verification is a launch blocker: unverified apps have a lifetime 100-user cap. Do not publish the URL before it is granted.
- Cloudflare: Workers Paid plan, KV namespace (`pnpm wrangler kv namespace create MATCH_CACHE` → id into `wrangler.jsonc`), custom domain, Workers Logs on.

## Status

Worker complete and tested. YouTube fixtures are **recorded** (2026-09-02, redacted); Spotify fixtures are still **synthetic** until `SPOTIFY_CLIENT_ID=… pnpm spike:spotify` runs (overwrites `worker/test/fixtures/spotify-*.json`; redact afterwards, see `worker/CLAUDE.md`). Still to do before launch: matcher calibration (`worker/scripts/calibrate-match.ts`, needs real Spotify fixtures), Google verification + Data API quota increase. Web (Part B) not started.
