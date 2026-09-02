# worker/

Cloudflare Worker: Hono routes + OAuth + provider clients + the job engine. Tests run inside workerd via `@cloudflare/vitest-pool-workers`.

## Module map (`src/`)

| File | Responsibility |
|---|---|
| `index.ts` | Hono app. Middleware order: `securityHeaders` on `*`, `sameOrigin` on `/api/*` and `/auth/*`. Routes: session, Spotify PKCE start/callback/logout, Google device-code start/poll/logout, `/api/library`, `/api/jobs*`, `/api/stats`, `/t/:id` app shell (adds `X-Robots-Tag: noindex`), then `ASSETS` fallthrough. Exports `JobDO`, `StatsDO`. |
| `env.ts` | `Env` interface: bindings (`ASSETS`, `JOB`, `STATS`, `MATCH_CACHE`, optional `RL_*`) + secrets (`GOOGLE_CLIENT_ID/SECRET`, `COOKIE_SECRET`, `TOKEN_SECRET`) + `PUBLIC_ORIGIN`. |
| `http.ts` | `HttpError(status, code, message)`, `withSecurityHeaders` (also called from `app.onError`), `sameOrigin` (Sec-Fetch-Site / Origin guard on non-GET), `rateLimit(binding, keyFn?)` (no-op when the binding is absent). |
| `cookie.ts` | AES-GCM sealed, HttpOnly, SameSite=Lax cookies: `sl_s` session (1 h) and `sl_o` OAuth transient (15 min); `__Host-` prefix + Secure on https. Fails loudly above 3.8 KB. |
| `crypto.ts` | `seal/open` (AES-256-GCM, base64url iv‖ct‖tag), `randomId` (128 bits → 26 lowercase Crockford chars, `ID_RE`), PKCE verifier/challenge, base64url helpers. |
| `spotify.ts` | PKCE URL/exchange/refresh (no client secret), `Spotify` client with transparent refresh + `onRefresh` persistence, 30 s timeout → `SpotifyError(429,'timeout')`, `toTrack` (handles `item` and legacy `track` wrappers, local files, episodes, null entries). |
| `google.ts` | Device-code flow (`deviceCode`, `pollDevice` → pending/slow_down/denied/expired/ok) and `refreshGoogle`. |
| `innertube.ts` | One `InnerTube` class, three transports: `music()` anonymous `WEB_REMIX` on music.youtube.com (search songs/videos/albums/artists, album → `OLAK5uy_` id via `microformat.urlCanonical`); `tv()` `TVHTML5` on www.youtube.com with the bearer token (`addPlaylistItems`, `like`, `likePlaylist` = save album, `subscribe`); `data()` Data API v3 (`createPlaylist` = `playlists.insert`, `playlistVideoIds`/`likedVideoIds` = `playlistItems.list`, `LL` = liked videos). Errors: 401 → `AuthError`; 429/5xx/HTML-200/403-HTML-abuse-page/timeout → `ThrottleError`; Data API `quotaExceeded` → `ThrottleError` with `retryAfterMs` until midnight Pacific; other Data API 403 → `AuthError`. |
| `match.ts` | `stripFeat`, `buildQuery` (primary artist + title, no `&`), `cacheKey` (`artist|title`, NFKD, lowercase, punctuation collapsed), Dice-bigram `similarity`, `score`, `pickBest` with the confidence gate (title ≥ 0.6, artist ≥ 0.5, duration Δ ≤ 15 s). |
| `csv.ts` | `toCsv` with BOM, CRLF, RFC quoting. |
| `job-do.ts` | `JobDO`: the transfer engine (below). |
| `stats-do.ts` | `StatsDO`: global counters for the landing page (`add`, `get` → tracksMoved, jobs, matchRate, medianMinutes over runs ≥ 100 tracks). |
| `routes-validate.ts` | `validateSelection` for `POST /api/jobs` (Spotify id regex, length caps, 500/2000/2000 item caps). |

`scripts/` holds one-off Node scripts run from the repo root with `pnpm spike:innertube` / `pnpm spike:spotify` (tsx is a root devDependency; outside the worker typecheck): `spike-innertube.ts`, `spike-spotify.ts` record fixtures with real credentials.

## JobDO

One SQLite Durable Object per job, addressed by `idFromName(jobId)`; the 26-char job id is the only secret. Tables `job` (one row: status, sealed tokens, attempt/throttle, counters), `item` (ordered: liked / playlist / album / artist), `track`.

State machines. Item: `queued → fetching → matching → writing → verifying → done | failed`. Job: `running ⇄ paused`, `running → done | failed`. Track: `pending → matched → moved`, or `review` / `skipped`; a track's status never goes backwards, so progress never runs backwards.

Invariants:
- Every unit of work (`step()`) is persisted in a `transactionSync` before the next `await`. A crash anywhere resumes at the last step.
- `alarm()` → `tick()` runs `step()` in a loop for ≤ 50 s wall-clock, then re-arms itself. Concurrency is 2 searches per step (`CONCURRENCY`; ponytail ceiling, upgrade path = global limiter DO).
- Errors: `ThrottleError` / Spotify 429 → exponential backoff (5 s → 10 min, or the provider's own `retryAfterMs` / `retry-after`: a Data API quota hit parks the job until midnight Pacific) recorded in `throttled_until`; `AuthError`/Google/Spotify 401 → `fail('auth_expired')`; anything else retries 8× then `fail('provider_error')`. Paused jobs and jobs older than 24 h expire.
- Verify (D15): after writes, read the playlist (and `LL` for `liked`) back through the Data API; mark missing tracks `redo` and re-drive; up to `MAX_VERIFY_PASSES = 3`, then `write_failed` review items.
- Collapsed matches (D16): if a track's best video is already used by another track in the same item, it becomes a `duplicate_match` review item with a suggestion, never silently merged.
- Liked songs (D18): a private "Liked Songs" mirror playlist plus individual likes (oldest first).
- Tokens: sealed with `TOKEN_SECRET`; Spotify tokens wiped at finish, YouTube token kept 24 h for review actions (`disconnect()` wipes early), storage deleted 7 days after finish.
- Match cache: KV `m1:<cacheKey>` → videoId, 180-day TTL, confident matches only.
- RPC methods return values (`start()` returns `{ok:false,error}`) instead of throwing: a throw inside an RPC is also logged by workerd as an uncaught exception.

Logs are single-line JSON with `evt`: `throttle`, `verify`, `job_done`, `job_failed`, `tick_error`, `unhandled`, `job_created`. Job ids are logged as their first 6 characters.

## Testing

- `pnpm --filter worker test` runs Vitest 4 inside workerd (`vitest.config.ts` → `cloudflareTest({ wrangler: { configPath: '../wrangler.jsonc' }, miniflare: { bindings, kvNamespaces } })`). `test/env.d.ts` merges `Env` into `Cloudflare.Env` so `env.JOB` etc. type-check.
- Outbound HTTP is mocked by `test/fetch-mock.ts`, a small undici-style shim over `globalThis.fetch` (`fetchMock.get(origin).intercept({ path, method, headers, body }).reply(status, data | fn, { headers }).times(n).delay(ms)`). `@cloudflare/vitest-pool-workers` 0.22 no longer exports `fetchMock`. Call `fetchMock.activate(); fetchMock.disableNetConnect()` in `beforeAll`; add `afterEach(() => fetchMock.assertNoPendingInterceptors())` to catch leftovers. `path` is pathname + query.
- KV/DO storage is **not** isolated between tests in this pool version: call `await reset()` (from `cloudflare:test`) in `beforeEach` of any test that touches `MATCH_CACHE` (JobDO tests do).
- workerd fires due alarms natively: after `start()`/`resume()` the DO is already ticking. Poll with `vi.waitFor` (`settle()` helper) and use `runDurableObjectAlarm` only to fast-forward an alarm scheduled in the future while nothing is in flight (backoff, expiry). Calling it while a tick runs returns `false`.
- Every test that moves ≥ 1 track needs a read-back (`READBACK`) interceptor, or the verify pass hangs on an un-mocked fetch and the job backs off.
- YouTube fixtures (`innertube-*.json`, `data-*.json`) are recorded (`_recorded` note) by `pnpm spike:innertube`, which redacts `visitorData`/`consistencyTokenJar` itself. Spotify fixtures (`spotify-*.json`) still carry a `_synthetic` note until `pnpm spike:spotify` runs; then redact:
  `cd worker/test/fixtures && sed -i '' -E 's/"(email|display_name|id)":"[^"]*"/"\1":"REDACTED"/g' spotify-me.json && grep -l "@gmail" *.json || echo clean`.
  If a parser test fails on a real fixture, fix the parser to the fixture, never the fixture to the parser.

## Provider gotchas (measured on a 3,000-track migration)

- A TV-client OAuth token is accepted only with a `TVHTML5` context on www.youtube.com; `WEB_REMIX`/`WEB`/`ANDROID*` answer `400 INVALID_ARGUMENT`, and `TVHTML5` cannot create playlists (`Precondition check failed`) → Data API `playlists.insert` (D3). Searches are anonymous, so throttling is per egress IP (D8): the abuse page (403 HTML "Sorry…") is a throttle, handled by backoff + the KV cache.
- Writes can return 200 and do nothing (346 of 2,585 likes did) → always read back (D15). A hung request never times out on its own → 30 s `AbortSignal.timeout` everywhere (D17). Throttled responses can be HTML with status 200.
- Different Spotify tracks collapse onto the same video (451 of 3,036) → review, not merge (D16).
- Spotify: `/playlists/{id}/items` entries use `item` (not `track`); `/me/playlists` exposes `items.total` (`tracks` is gone); local files have `is_local` and no id; podcasts arrive as `episode` and are skipped. A Development Mode app gets **403 on playlists owned by other users** (followed playlists): JobDO fails just that item (`not_accessible`), the Select screen must disable them.
- Measured throughput: ~45 uncached searches/min; ETA maths in `view()` uses the live rate once 30 searches are in.
