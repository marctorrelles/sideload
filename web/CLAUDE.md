# web/

Astro 7 static site + Preact islands. Built into `web/dist`, served by the Worker as static assets (`run_worker_first: true`, so every response passes through the worker's security headers). The spec is `docs/design/handoff.md` (tokens, copy, interactions) + `docs/design/sideload-final.dc.html` (visual reference). Aesthetic is terminal calm: square corners, hairlines, mono eyebrows, blinking block cursor on live values, rows that arrive like log lines. Nothing bounces.

## Map

| Path | What |
|---|---|
| `src/layouts/Base.astro` | Head (title, description, canonical, OG, optional `noindex`, optional JSON-LD), `<ClientRouter />` view transitions, Header, optional StepBar, Footer. |
| `src/components/` | `Header.astro` (mark + wordmark; the mark is inline SVG in `currentColor` with an accent dot, 26/22 px), `StepBar.astro` (markup only; styles are global in `components.css` because the Transfer island renders its own bar; completed steps are links), `Footer.astro`, `CoffeePanel.astro`. |
| `src/pages/index.astro` | Landing (Marc's 2026-09-03 mock, not the handoff): centered hero, the facts strip (`Stats` island: nothing until 1,000 tracks are really moved, then songs moved / matched first try / typical minutes / $0, sharing the box with the steps), three steps, `SoftwareApplication` JSON-LD. |
| `src/pages/faq.astro`, `privacy.astro` (`#terms`), `404.astro` | Static prose pages. FAQ emits `FAQPage` JSON-LD. Privacy/terms are what Google verification links to. |
| `src/pages/connect.astro` + `src/islands/Connect.tsx` | Step 01. Source card has a *setup* state (BYO Spotify Client ID, redirect-URI copy button) before *connected*; destination card runs the Google device-code flow and polls `/auth/google/poll`. |
| `src/pages/select.astro` + `src/islands/Select.tsx` | Step 02. Tabs, tri-state select-all, shift-click ranges, sort, "+ N more" expansion (no virtualisation; 500-playlist cap), summary panel → sticky bar on mobile. Playlists owned by other users render locked (a Development Mode Spotify app cannot read them). |
| `src/pages/t/index.astro` + `src/islands/Transfer.tsx`, `ReviewItem.tsx` | `/t/:id` (the worker serves `/t/index.html` for any valid id and adds `X-Robots-Tag: noindex`). Polls every 2.5 s while running (10 s hidden/paused), renders running / paused / failed / done / not-found, renders its own step bar. Review rows: Use closest / Add anyway / Try again, inline manual search, Skip; rows collapse on success. Under 900 px the review column collapses to one toggle row. |
| `src/lib/api.ts` | Typed client for the worker (`ApiError` carries status + code). Same-origin cookies. |
| `src/lib/selection.ts` | Pure Choose-step helpers (`defaultSel`, `totals`, `triState`, `rangeToggle`, `sortBy`, `toSelection`, `selectable`). Tested. |
| `src/lib/format.ts` | `n`, `compact`, `pct`, `eta`, `preEstimate` (45 searches/min, D11), `duration`. Tested. |
| `src/islands/Grainient.tsx` | The animated grain gradient behind the landing hero: react-bits "Grainient" shader (MIT + Commons Clause, notice kept in the file) ported to raw WebGL2, no dependency. Mounts `client:visible`, pauses offscreen and in hidden tabs, one still frame under reduced motion, fades in on its first frame, stops on `astro:before-swap`. Colours and `centerY` are props on `index.astro`. Headless Chrome never hydrates islands under `--dump-dom`, so check it in a real browser. |
| `src/lib/Logo.tsx` | Provider marks (Spotify, YouTube Music, Apple Music, Tidal): the `mono.svg` paths from thesvg.org (MIT), drawn in `currentColor`. `.art` is the 36/46 px framed box around a mark; `.row.is-selected .logo` turns accent. Rows without artwork show the Spotify mark in an `.art` box. |
| `src/lib/motion.ts` | `reveal` (stagger rows via `.reveal > *` in `motion.css`), `countTo` (rAF; never counts down unless told), `onView` (IntersectionObserver), `collapse`, `crossfade`, `flash`. Vanilla on purpose: an animation library's Web Animations path calls `commitStyles()`, which writes a `style` attribute and the CSP blocks it. Every helper is a no-op under `prefers-reduced-motion`. |
| `scripts/mock-api.mjs` | Stand-in for the Worker on 8787 (`pnpm --filter web mock` instead of `wrangler dev`): connected session, the recorded Spotify library, stats, and jobs by id prefix (`r…` running, `d…` done, `f…` failed, 26 chars). The only way to see Select/Transfer without real accounts. |
| `src/styles/` | `tokens.css` (every value from the handoff table, `--gutter` 40/18), `base.css` (reset, fonts, type roles), `components.css` (btn, checkbox, list/row, track/seg, tabs, panel, placeholder, kv, stepbar), `motion.css` (keyframes + reduced-motion kill switch). Page-specific CSS lives in each page's `<style is:global>` since island markup is client-rendered. |

## Rules

- Islands that read `location` (Connect, Select, Transfer) mount with `client:only="preact"`, never `client:load` (they must not SSR). `Stats` is `client:idle`, `Grainient` is `client:visible`.
- Astro dev sometimes keeps serving a stale scoped `<style>` module after a page or component style block is edited from outside the editor; if a style change does not show up, restart `pnpm dev:web`.
- **No `style=""` attributes in `.astro` markup**: the CSP `<meta>` Astro emits has no `unsafe-inline` for styles. Preact islands may set `style` (applied through the CSSOM). Prefer classes anyway.
- Astro hashes its own inline scripts into the CSP; page `<script>` blocks are bundled to `_astro/*.js` (`script-src 'self'`). JSON-LD is a data block and is not subject to `script-src`. Astro does **not** hash the `<style>` blocks it emits for `transition:name`/`transition:animate` scopes, so the `cspStyleHashes` hook in `astro.config.mjs` hashes every inline `<style>` in the built HTML into `style-src` after the build. Never add `unsafe-inline`: browsers ignore it once hashes are present anyway.
- In dev, a Vite middleware in `astro.config.mjs` rewrites `/t/<26-char id>` to `/t` (production relies on the Worker for that).
- `build.format: 'preserve'` → `connect.astro` becomes `/connect.html` (served at `/connect` by `html_handling`), `t/index.astro` → `/t/index.html`. `trailingSlash: 'never'`.
- App routes (`/connect`, `/select`, `/t/*`, `/404`) are `noindex` and excluded from the sitemap; `robots.txt` disallows them plus `/api/` and `/auth/`.
- Type is one step larger than the handoff (2026-09-03: every size ≤ 17 px ×1.15, 18–30 px ×1.08, headings unchanged). Copy is verbatim from the handoff except: the landing (rewritten to Marc's mock), BYO Spotify setup state, device-code state, honest estimates, no fake hero stats, no undo toast on review actions (a resolved row just collapses). Tokens deviate in one place: `--fg-3/4/5` are brighter than the handoff (.52/.47/.42 instead of .45/.35/.28) so 10–12 px text clears 4.5:1 contrast.
- Progress never runs backwards: `Transfer.tsx` clamps `totals.moved` to the highest value seen; `countTo` refuses to count down for progress values.
- Fonts are self-hosted via Fontsource (`@fontsource-variable/archivo`, `@fontsource/ibm-plex-mono` 400/500/600); `font-src 'self'`.

## Commands

```
pnpm --filter web dev        # astro dev on 127.0.0.1:4321, proxies /api and /auth to wrangler on 8787 (run `pnpm dev` at the root for both)
pnpm --filter web build      # → web/dist (needed before `wrangler dev`/`deploy`; the worker's tests only need the directory to exist)
pnpm --filter web test       # vitest, node environment, test/*.test.ts (pure libs only)
pnpm --filter web exec astro check
pnpm --filter web mock         # mock Worker on 8787 for visual QA (stop wrangler first)
```

## Visual QA (no browser session needed)

- Screenshots: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1280,1100 --screenshot=out.png http://127.0.0.1:4321/`.
- Mobile: headless Chrome will not shrink its window below ~500 px, so a `--window-size=390,…` shot is a crop of a wider layout. Wrap the page in a local HTML file with `<iframe src="…" width="390" height="1500">` and screenshot that file instead; media queries then really apply.
- Animated values: `--virtual-time-budget` runs one animation frame at most, so counters and revealed rows look frozen at their start. Use `--timeout=4000` (real time) or `--force-prefers-reduced-motion` (every helper is a no-op) before calling something a bug.
- Lighthouse on the built site: `pnpm --filter web build && pnpm --filter web exec astro preview --port 4322`, then `CHROME_PATH=… pnpm dlx lighthouse http://localhost:4322/ --preset=desktop --output=json`. `/`, `/faq`, `/privacy` score 100/100/100/100 (2026-09-02); the CSP console errors and contrast were the two things that used to cost points.
- Raster assets are reproducible: `sh web/scripts/render-assets.sh` renders `public/og.png` (1200×630, from `scripts/og.html`), `apple-touch-icon.png` and `favicon-32.png` (from `scripts/icon.html`) with headless Chrome + `sips`. `favicon.svg` is the mark on the page background; the PNG exists because Safari ignores SVG favicons.
