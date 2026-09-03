# Sideload

Move your Spotify library (playlists, liked songs, saved albums, followed artists) to YouTube Music. Free, open source, no account. Runs on one Cloudflare Worker.

**https://sideload.marctorrelles.com** · [Buy me a coffee](https://buymeacoffee.com/marctorrelles)


## Self-hosting / Operating

**Accounts you need.** A Google Cloud project with the YouTube Data API v3 enabled and an OAuth client of type *TVs and Limited Input devices* (scope `https://www.googleapis.com/auth/youtube`; the consent screen needs brand + sensitive-scope verification before more than 100 people can use it). A Cloudflare account on the Workers Paid plan with a KV namespace (`pnpm wrangler kv namespace create MATCH_CACHE`, paste the id into `wrangler.jsonc`) and a custom domain. Users bring their own Spotify Client ID, so no Spotify app is needed to run the service, only to develop it.

**Secrets.** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_SECRET`, `TOKEN_SECRET` (32 random bytes, base64url: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`). Locally they live in `.dev.vars` (copy `.dev.vars.example`); in production set each with `pnpm wrangler secret put NAME`. `PUBLIC_ORIGIN` is a plain var in `wrangler.jsonc`.

**Commands.** `pnpm install` · `pnpm test` · `pnpm dev` (worker on 8787, site on 4321 proxying `/api` and `/auth`) · `pnpm deploy` (builds the site, then `wrangler deploy`). `main` deploys automatically through GitHub Actions; roll back with `pnpm wrangler rollback`.

**Live logs.** `pnpm wrangler tail --format pretty`. Every log line is one JSON object with an `evt`:
`job_created` · `throttle` (attempt, wait, err) · `verify` (one per read-back pass: `missingAdds`, `missingLikes`) · `job_done` (`verifyPasses`, `collapsed`, `writeFailed`, `searches`, `cacheHits`, `seconds`) · `job_failed` · `tick_error` · `unhandled`. Job ids are logged as their first 6 characters only.

**Reading a job's state.** Open the Durable Object in the Cloudflare dashboard (Workers → sideload → Durable Objects → JobDO → SQL) or call `GET /api/jobs/<id>` with the full id.

**Cost model.** Per job: about one alarm per 50 s of work, one KV read per track, one KV write per cache miss. A 5,000-track job is roughly 120 alarms, 5,000 KV reads and up to 5,000 KV writes, well under $0.05. The $5/month Workers Paid plan covers thousands of jobs.

**When YouTube changes something.** Re-run `pnpm spike:innertube` with your `.dev.vars`, look at what the new response looks like, adjust the parser in `worker/src/innertube.ts`, re-record the fixtures (redacted), and run the tests. The same goes for Spotify with `pnpm spike:spotify`.
