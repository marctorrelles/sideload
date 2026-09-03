# Sideload

Free, MIT-licensed web service that moves a Spotify library (playlists, liked songs, saved albums, followed artists) to YouTube Music. One Cloudflare Worker (Hono) serves the API and the static Astro site; each transfer is a SQLite Durable Object driven by alarms, so a job survives crashes and resumes for free. Users bring their own Spotify Client ID (PKCE, no secret). YouTube side, verified live 2026-09-02: searches are anonymous InnerTube (the `ANDROID_MUSIC` and `IOS_MUSIC` app clients with retries, `WEB_REMIX` last: from Cloudflare's egress the web client gets Google's abuse page or a 404 on every call and the app clients on the odd request, measured 2026-09-03), adds/likes/subscribes go through InnerTube `TVHTML5` with a Google "TV and Limited Input devices" OAuth token (device-code flow; the only InnerTube client that accepts it), playlist creation and read-back verification go through the YouTube Data API v3 (50 units per playlist, 1 unit per 50 items read). The visual/copy spec is `docs/design/handoff.md` + `docs/design/sideload-final.dc.html`.

## Repo rules

- **pnpm** only (`pnpm-workspace.yaml`: `worker`, `web`). Node 22 (`.nvmrc`; wrangler 4 needs ≥ 22). `allowBuilds` in `pnpm-workspace.yaml` approves `esbuild`/`workerd` postinstalls.
- Everything under `docs/` except `docs/design/` is gitignored: local planning material lives there. Never commit it and never reference it from code, docs or commit messages.
- No AI attribution anywhere: no `Co-Authored-By`, no tool names in commits, authors or docs.
- No em dashes anywhere: code, comments, UI copy, docs, commit messages. Use a period, comma, colon, semicolon or parentheses; a middle dot (·) in titles and labels.
- One commit per task, conventional prefixes (`feat(worker):`, `chore:`, `docs:`, `ci:`). Keep `pnpm test` and `pnpm --filter worker typecheck` green at every commit.
- Secrets live in `.dev.vars` (gitignored, copy `.dev.vars.example`) locally and in `wrangler secret` in production. Never in `wrangler.jsonc`.
- Each package has its own `CLAUDE.md` with the conventions for that path; update it at the end of any phase that touches the package.

## Commands

```
pnpm install                      # once; needs Node 22
pnpm test                         # all workspaces (worker runs inside workerd)
pnpm --filter worker test         # worker only; `pnpm --filter worker exec vitest run test/x.test.ts -t "name"` for one case
pnpm --filter worker typecheck
pnpm dev                          # wrangler dev on 8787 + astro dev on 4321
pnpm --filter web mock            # mock Worker on 8787 instead of wrangler: Select/Transfer screens without real accounts
pnpm dev:worker                   # worker alone: curl -si http://127.0.0.1:8787/api/stats
pnpm deploy                       # build site, wrangler deploy (CI does this on main)
```

## Layout

- `worker/`: the Worker: routes, OAuth, InnerTube client, matcher, JobDO/StatsDO. See `worker/CLAUDE.md`.
- `web/`: Astro 7 static site + Preact islands (landing, FAQ, privacy, the three step screens). See `web/CLAUDE.md`.
- `shared/types.ts`: DTOs shared by worker and web; no runtime code.
- `wrangler.jsonc`: single Worker config: assets (`run_worker_first`), DOs (`JobDO`, `StatsDO`, SQLite migration `v1`), KV `MATCH_CACHE`, rate-limit bindings `RL_*`, `PUBLIC_ORIGIN` var.
- `.github/workflows/`: `ci.yml` (PR + main: install, build web, typecheck, test), `deploy.yml` (main → `wrangler deploy`; needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` repo secrets).
- `SECURITY.md`: reporting policy + the pre-launch checklist. `README.md`: user-facing intro + operator runbook.

## Accounts and external constraints (verified 2026-09-02)

- Spotify Development Mode apps are capped at 5 users per Client ID and the owner needs Premium → every user brings their own Client ID. Redirect URI must use `127.0.0.1`, not `localhost`. Such an app cannot read playlists owned by other users (403): followed playlists are shown disabled and skipped.
- YouTube Data API v3 quota (10k units/day, 100 per search, 50 per insert) rules it out for search and item adds → InnerTube for those. OAuth tokens are rejected by InnerTube's music/web/android clients (400) and accepted only by `TVHTML5`, which cannot create playlists → `playlists.insert` on the Data API (50 units; ~200 playlists/day until a quota increase is granted, request it with verification).
- Google's abuse page (403 HTML "Sorry…") shows up after request bursts from one IP, and from Cloudflare's egress it hits the anonymous web music client on nearly every call (a 404 "Requested entity was not found" JSON is the other answer); the Android app client passes from the same IPs. The client treats both as a throttle and backs off. Probe recipe: a scratch Worker under `wrangler dev --remote` reproduces the edge's IP reputation without a deploy.
- Google sensitive-scope verification is a launch blocker: unverified apps have a lifetime 100-user cap. Do not publish the URL before it is granted.
- Cloudflare: Workers Paid plan, KV namespace (`pnpm wrangler kv namespace create MATCH_CACHE` → id into `wrangler.jsonc`), custom domain, Workers Logs on.

## Status

Worker and web complete and tested (58 worker tests inside workerd, 4 web tests, `astro check` clean; Lighthouse 100/100/100/100 on `/`, `/faq`, `/privacy` as of 2026-09-02). All provider fixtures are **recorded** (2026-09-02, redacted by the spike scripts; `pnpm spike:innertube`, `pnpm spike:spotify`). Verified with real accounts on 2026-09-03: Connect (BYO Spotify app, Google device code), Choose, Transfer, review actions and the done screen; keyboard and shift-click range checked. Matcher calibrated 2026-09-03 (`pnpm calibrate`, see `worker/CLAUDE.md`). Cloudflare: KV namespace created and its id is in `wrangler.jsonc`; still owed: the four `wrangler secret put`, the first `pnpm deploy` (the custom domain needs the `marctorrelles.com` zone on the account), Google verification + Data API quota increase, public GitHub repo + `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets for CI.
