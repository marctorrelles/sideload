# Security

Sideload handles OAuth tokens for Spotify and YouTube Music. If you find a vulnerability, email marctorrelles@gmail.com with steps to reproduce. Please do not open a public issue. You will get a reply within 7 days.

What we store: see the Privacy page (`/privacy`). Tokens are AES-GCM encrypted at rest inside a per-job Durable Object and deleted when the job finishes (Spotify) or within 24 hours (YouTube Music).

## Security checks

What the Worker guarantees and how to see it. Rerun after any change to auth, cookies, headers or rate limits: the curl lines run against production, the rest against the checkout. Last full run: 2026-09-03.

- **Cookies** carry the `__Host-` prefix, `HttpOnly; Secure; SameSite=Lax` and a short lifetime. `curl -si -X POST https://sideload.marctorrelles.com/auth/google/start -H 'Sec-Fetch-Site: same-origin' | grep -i set-cookie` → `__Host-sl_o=…; Max-Age=900; Path=/; HttpOnly; Secure; SameSite=Lax`.
- **CSRF**: state-changing routes refuse cross-site requests. The same request with `-H 'Sec-Fetch-Site: cross-site'` → `403 {"error":"cross_site"}`.
- **OAuth state** is checked before any token exchange. `curl -si 'https://sideload.marctorrelles.com/auth/spotify/callback?code=x&state=bad'` → `302` to `/connect?spotify_error=state_mismatch` and no `set-cookie`.
- **No open redirect**: the callback only ever redirects to `/connect`. `grep -n 'c.redirect(' worker/src/index.ts` shows two fixed paths and no user input.
- **Job ids** are 26 Crockford characters, 128 bits (`ID_RE` in `worker/src/crypto.ts`), logged as their first 6 characters only; `Referrer-Policy: strict-origin-when-cross-origin` keeps `/t/:id` out of third-party referrers and outbound links carry `rel="noopener noreferrer"`.
- **Tokens at rest** are sealed: the JobDO test reads `spotify_tokens` straight out of SQLite and asserts it is not plaintext. Secrets exist only as `wrangler secret`; `git check-ignore .dev.vars` prints the file.
- **Tokens in transit** go only to `accounts.spotify.com`, `api.spotify.com`, `oauth2.googleapis.com`, `www.googleapis.com`, `music.youtube.com` and `www.youtube.com`. `grep -rohE 'https://[a-z0-9.-]+' worker/src/*.ts | sort -u` lists those plus `api.mixpanel.com`, which receives counts under a random id and never a token.
- **Headers**: `curl -sI https://sideload.marctorrelles.com/` → HSTS with preload, `x-content-type-options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `content-security-policy: frame-ancestors 'none'`; the HTML carries Astro's `<meta http-equiv="content-security-policy">` with `script-src 'self' 'sha256-…'` and no `unsafe-inline`.
- **Rate limits** (`wrangler.jsonc`): 10 auth starts and 3 job creations per minute, 60 reads per 10 s, 20 searches per minute, keyed by client IP. Cloudflare's counters are not shared across the machines in a location, so a probe must reuse one connection: `curl -s -o /dev/null -w '%{http_code}\n' 'https://sideload.marctorrelles.com/api/session?n=[1-70]' | sort | uniq -c` → about 60 `200` and the rest `429`. Separate connections spread across machines and each machine sees a fraction of the traffic: the limits are a brake on scripts, not a hard cap.
- **Input caps**: `POST /api/jobs` answers `413` to more than 500 playlists or 2,000 albums or artists, `400` to a negative `trackCount`, a bad id, a name over 200 characters or an empty selection; manual search queries are cut to 200 characters. `worker/test/routes-validate.test.ts` covers each (the route checks the session first, so an unauthenticated curl sees `401`).
- **Robots**: `curl -sI https://sideload.marctorrelles.com/t/01arz3ndektsv4rrffq69g5fav` → `x-robots-tag: noindex`; `/robots.txt` disallows `/t/`, `/connect`, `/select`, `/api/` and `/auth/` (Cloudflare prepends its managed AI-crawler block).
- **Retention**: a finished job drops `spotify_tokens` at once, `yt_tokens` 24 hours later and the whole record after 7 days; a failed job drops both at once. The end-to-end JobDO test fast-forwards both alarms and asserts each step.
- **Logs** are structured JSON with an `evt`, job ids cut to 6 characters and error strings capped; `grep -n 'console\.' worker/src/*.ts` shows nothing else.
- **Dependencies**: `pnpm audit --prod` is clean, versions are pinned by the lockfile, Dependabot alerts are on for the repository.
