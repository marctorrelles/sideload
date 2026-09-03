# Security

Sideload handles OAuth tokens for Spotify and YouTube Music. If you find a vulnerability, email marctorrelles@gmail.com with steps to reproduce. Please do not open a public issue. You will get a reply within 7 days.

What we store: see the Privacy page (`/privacy`). Tokens are AES-GCM encrypted at rest inside a per-job Durable Object and deleted when the job finishes (Spotify) or within 24 hours (YouTube Music).

## Pre-launch checklist

Run every line before the URL is published, and again after any change to auth, cookies or headers. Each line is a check, the command, and the expected result.

- [ ] Cookies: `curl -si -X POST https://sideload.marctorrelles.com/auth/google/start -H 'Sec-Fetch-Site: same-origin'` → `set-cookie: __Host-sl_o=…; Max-Age=900; Path=/; HttpOnly; Secure; SameSite=Lax`.
- [ ] CSRF: same request with `-H 'Sec-Fetch-Site: cross-site'` → `403 {"error":"cross_site"}`.
- [ ] OAuth state: `/auth/spotify/callback?code=x&state=bad` → 302 to `/connect?spotify_error=state_mismatch`, no `sl_s` cookie.
- [ ] Open redirect: the callback only ever redirects to `/connect` (`grep -n 'c.redirect(' worker/src/index.ts`; no user input flows in).
- [ ] Job id entropy: `ID_RE` is 26 Crockford chars = 128 bits; ids are never logged in full (`.slice(0, 6)`); `Referrer-Policy` keeps `/t/:id` out of third-party referrers (the coffee link has `rel="noopener noreferrer"`).
- [ ] Tokens at rest: the JobDO test asserts sealed strings (`SELECT spotify_tokens` never equals plaintext); secrets only via `wrangler secret`; `.dev.vars` is gitignored (`git check-ignore .dev.vars` prints it).
- [ ] Tokens in transit: only ever to `accounts.spotify.com`, `api.spotify.com`, `oauth2.googleapis.com`, `music.youtube.com`; `grep -n 'fetch(' worker/src/*.ts` shows no other hosts.
- [ ] Headers: `curl -sI https://sideload.marctorrelles.com/` → HSTS, nosniff, Referrer-Policy, Permissions-Policy, `content-security-policy: frame-ancestors 'none'`; the HTML carries Astro's `<meta http-equiv="content-security-policy"` with `script-src 'self' 'sha256-…'`.
- [ ] Rate limits: `for i in $(seq 1 5); do curl -s -o /dev/null -w '%{http_code}\n' -X POST https://sideload.marctorrelles.com/api/jobs -H 'Sec-Fetch-Site: same-origin'; done` → the 4th/5th print `429` (earlier ones `401`).
- [ ] Input caps: `POST /api/jobs` with 501 playlists → 413; `trackCount: -1` → 400; manual search `q` > 200 chars is truncated (no 500).
- [ ] Robots: `/t/<id>` responds `x-robots-tag: noindex`; `robots.txt` disallows `/t/`, `/connect`, `/select`, `/api/`, `/auth/`.
- [ ] Retention: a finished job's `spotify_tokens` is NULL immediately, `yt_tokens` NULL after 24 h (test: set `finished_at` back 25 h, run the alarm), storage empty after 7 days.
- [ ] Logs contain no emails/tokens: `grep -n 'console\.' worker/src/*.ts` → only structured objects with `job: id.slice(0,6)` and counts.
- [ ] Dependencies: `pnpm audit --prod` clean; `hono` and `wrangler` pinned by the lockfile; Dependabot enabled on the repo.
