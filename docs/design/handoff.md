# Handoff: Sideload — Spotify → YouTube Music playlist transfer

## Overview
Sideload is a free web tool that copies a user's Spotify library (playlists, liked songs, saved albums, followed artists) into another streaming service — YouTube Music at launch, Apple Music and Tidal marked "soon". The flow is: marketing hero → 01 Connect → 02 Choose → 03 Transfer → Done. Transfers run server-side, so the tab can be closed and the job resumed from a persistent job URL.

No user accounts. Both OAuth tokens are dropped when a transfer finishes. Monetisation is a single "Buy me a coffee" link.

## About the Design Files
`Sideload.dc.html` in this bundle is a **design reference created in HTML** — a static prototype showing intended look, copy and layout. It is not production code and should not be copied into the app.

The task is to **recreate these screens in the target codebase's existing environment** (React, Vue, Svelte, whatever is in use) using its established component patterns, routing and styling approach. If no codebase exists yet, pick an appropriate stack (e.g. React + Vite + Tailwind, or Next.js) and implement the screens there.

The file contains the final screens only — a desktop row (hero → 01 Connect → 02 Choose → 03 Transferring → Done) and a mobile row at 390px. Every screen in it is in scope.

## Fidelity
**High-fidelity.** Colors, type, spacing and copy are final. Recreate pixel-close using the codebase's own primitives. Two caveats:
- All logo/artwork slots are **placeholders** (dashed boxes with diagonal hatching). Replace with real provider marks and playlist cover art.
- The prototype has no interactive states wired (no hover/focus/disabled CSS). States are specified in words below — implement them.

## Design Tokens

### Color
| Token | Value | Use |
|---|---|---|
| `bg` | `#121110` | Page background, cards, list rows |
| `bg-sunken` | `#0e0d0c` | Step sub-bar, sticky action bars |
| `bg-sunken-2` | `#0c0c0b` / `#0f0e0d` | Side panels, table toolbars |
| `bg-footer` | `#0c0b0a` | Footer |
| `bg-row-active` | `#1a1917` | Active tab, in-progress row |
| `fg` | `#f4f1eb` | Primary text |
| `fg-secondary` | `rgba(255,255,255,.60)` | Body copy |
| `fg-tertiary` | `rgba(255,255,255,.45)` | Meta, footer text |
| `fg-quaternary` | `rgba(255,255,255,.35)` | Disabled/overflow text |
| `hairline` | `rgba(255,255,255,.10)` | Section dividers, header/footer borders |
| `hairline-strong` | `rgba(255,255,255,.12)` | Table + card borders |
| `accent` | `#e0703f` | Primary CTA, progress fill, active step, selected checkbox |
| `accent-soft` | `#f0a58a` | Warnings / "needs review" |
| `accent-tint-bg` | `#1a1512` | Warning + destination panel backgrounds |
| `accent-tint-border` | `rgba(224,112,63,.50)` | Selected/destination borders |
| `accent-tint-fill` | `rgba(224,112,63,.12–.14)` | Selected row fill |
| `success` | `#7fc79a` | "connected", "all N songs", completed step |
| `success-border` | `rgba(127,199,154,.40)` | Connected source card border |
| `success-bg` | `#141614` | Connected source card background |
| `on-accent` | `#141110` | Text on accent and on light buttons |
| `light-btn` | `#f4f1eb` | Secondary emphasis button fill (coffee CTA) |

Accent tint on a warning list: border `rgba(240,165,138,.30–.35)`.

### Typography
Two families, loaded from Google Fonts:
- **Archivo** (400/500/600/700) — all UI and prose.
- **IBM Plex Mono** (400/500/600) — numbers, labels, meta, percentages.

| Role | Spec |
|---|---|
| Hero H1 (desktop) | Archivo 600, 58px, line-height 1.02, letter-spacing −0.038em |
| Screen H2 (desktop) | Archivo 600, 36px / 1.1, −0.03em |
| Done H2 (desktop) | Archivo 600, 46px / 1.05, −0.035em |
| Hero H1 (mobile) | Archivo 600, 38px / 1.02, −0.035em |
| Screen H2 (mobile) | Archivo 600, 25–26px / 1.12, −0.028em |
| Lede / body | Archivo 400, 15.5–16.5px / 1.6 (mobile 13.5–14.5px / 1.6) |
| Row title | Archivo 500, 13–13.5px |
| Row title (dense/mobile) | Archivo 500, 12.5–13px |
| Nav link | Archivo 500, 12.5px (mobile 12px) |
| Button label | Archivo 600, 14–15px (secondary 13.5–14px) |
| Mono label (eyebrow) | IBM Plex Mono 500, 10px, letter-spacing .10–.14em, uppercase |
| Mono meta | IBM Plex Mono 400, 11–12px |
| Big stat | IBM Plex Mono 600, 22–26px, −0.03em |
| Progress % (step 3) | IBM Plex Mono 600, 44px, −0.04em (mobile 34px) |
| Footer text | Archivo 400, 11.5px (mobile 11px) |

Prose blocks are capped by character measure, not px: hero lede `44ch`, screen ledes `52–58ch`, footer note `46ch`. Body copy uses `text-wrap: pretty`.

### Geometry
- **Border radius: 0 everywhere.** No rounded buttons, cards, inputs or progress bars. This is deliberate.
- **No shadows.** Depth comes from 1px hairlines and background steps.
- Desktop content gutter: `40px`. Mobile gutter: `18px`.
- Header: `16px 40px` padding, 1px bottom hairline. Step sub-bar: `12px 40px`. Footer: `18px 40px`.
- Section vertical rhythm: hero `66px` top, screens `44–56px` top, `34–46px` bottom.
- Table/list rows: `14px 16px` desktop, `13px 14px` mobile. Row separation is a **1px gap showing a `rgba(255,255,255,.09)` parent background**, not per-row borders (`display:flex; flex-direction:column; gap:1px; background:rgba(255,255,255,.09)`).
- Checkbox: 15×15px square. Checked = `accent` fill, `#141110` "✓" glyph at Archivo 700 10px. Unchecked = 1px `rgba(255,255,255,.3)` border, transparent.
- Progress bars: 5px (panel), 10–12px (step 3 hero), 3px (per-playlist inline). Segmented: flex-weighted children with `2px` gap — moved / needs-review / remaining.
- Placeholder art: 1px dashed `rgba(255,255,255,.20–.25)` + `repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0 5px, transparent 5px 10px)`. Sizes: 26–46px squares for provider marks, 34–36px for row thumbnails, ~96–120px blocks for the hero lockup.

### Layout grids
- Desktop canvas: **1120px** wide (design width; the real app should center a max-width container and let the hairline bars go full-bleed).
- Hero: `grid-template-columns: 1.06fr .94fr`, right panel on `#0c0c0b` with a left hairline.
- Hero "how it works": 3 equal columns split by vertical hairlines, `26px 40px` padding each.
- Step 1 (Connect): `grid-template-columns: 1fr 1fr; gap: 20px`.
- Step 2 (Choose): `grid-template-columns: 1fr 300px; gap: 24px` — list left, summary right.
- Step 3 (Transfer): full-width progress header, then `grid-template-columns: 1fr 1fr; gap: 24px` — activity left, review queue right.
- Done: `grid-template-columns: 1.15fr .85fr; gap: 44px`.
- Mobile canvas: **390px**. Everything stacks; primary actions live in a bottom bar (`position: sticky; bottom: 0`, `14px 18px`, `#0e0d0c`, 1px top hairline).

## Persistent chrome (identical on every screen)

**Header** — `16px 40px`, 1px bottom hairline `rgba(255,255,255,.1)`:
- Left: wordmark "Sideload", Archivo 700 17px, −0.02em.
- Right: `24px` gap row of links only, Archivo 500 12.5px `rgba(255,255,255,.6)`: `FAQ`, `GitHub`, and `Buy me a coffee` in full-strength `#f4f1eb`.
- Mobile: wordmark + `FAQ` / `Coffee` at 12px, `16px` gap, `14px 18px` padding.
- Header never changes between steps and carries no progress state.

**Step sub-bar** (flow screens only) — `12px 40px` on `#0e0d0c`, 1px bottom hairline, IBM Plex Mono 500 10–11px uppercase `.08em`, `26px` gap:
- Current step `#e0703f`; completed step `rgba(255,255,255,.38)` with a trailing `✓`; upcoming `rgba(255,255,255,.28)`.
- Labels: `01 Connect`, `02 Choose`, `03 Transfer`. On the done screen `03 Transfer ✓` is `#7fc79a`.
- Mobile shows the same three, `16px` gap, `11px 18px`, and abbreviates completed steps to `01 ✓`.

**Footer** — `18px 40px` on `#0c0b0a`, 1px top hairline, single row, space-between:
- Left, Archivo 400 11.5px `rgba(255,255,255,.35)`: "Free and open source. Not affiliated with Spotify, YouTube, Apple or Tidal."
- Right, same size `rgba(255,255,255,.45)`: "Made with ♥ by **Marc Torrelles**" — the name links to `https://marctorrelles.com`, color `rgba(255,255,255,.7)`. Use the plain `♥` glyph (U+2665), **not** the emoji.
- Mobile: stacks the two lines, `8px` gap, `18px` padding.

## Screens / Views

### 1. Hero / landing 
**Purpose:** explain the tool, establish that it's free and safe, start a transfer.

Layout: header → two-column split → three-column "how it works" strip → footer.

Left column (`66px 40px 60px`):
- Eyebrow, mono 10px uppercase `.12em`, `#e0703f`: "Free · no account needed" (`22px` below).
- H1: "Your library, ported cleanly."
- Lede (`44ch`, `22px` top): "Move your playlists, saved albums and followed artists from Spotify to YouTube Music, Apple Music or Tidal. Everything that can't be matched is listed for you at the end — nothing disappears quietly."
- Primary CTA `36px` below: accent fill, `#141110` text, Archivo 600 15px, padding `16px 28px`, square. Label "Start a transfer". **No helper copy beside it.**
- Stat row `54px` below, `24px` above a top hairline, `36px` gap: `1.2M` / tracks moved, `96.4%` / matched first try, `4 min` / typical library. Values mono 600 22px; labels mono 500 10px uppercase `rgba(255,255,255,.4)`.

Right column (`30px 32px 34px` on `#0c0c0b`, left hairline):
- Header row: "Transferring your library" (Archivo 600 12.5px) + "62%" (mono 500 11.5px, accent).
- 5px progress track `rgba(255,255,255,.12)`, accent fill at 62%, square.
- Four status rows (1px-gap list): `Deep Focus` / "all 312 songs" `#7fc79a`; `Liked songs` / "2,904 of 2,911" `rgba(255,255,255,.55)`; `road trip '24` / "3 to review" `#f0a58a`; `Saved albums` (dimmed) / "up next" `rgba(255,255,255,.35)`.
- Placeholder block, 118px tall: "provider logo lockup".

"How it works" strip — three columns, `26px 40px`, mono 10px uppercase eyebrows and 13.5px/1.5 body:
1. `01 — Connect`: "Sign in to Spotify, then to where you're going."
2. `02 — Choose`: "Tick what's worth keeping. Track counts shown."
3. `03 — Walk away`: "Come back to a finished library and a short review list."

Mobile version (first mobile card): same order, H1 38px, CTA full-width `17px` padding, stats in a 3-up row at 19px mono, then the status panel on `#0c0c0b`, then footer.

### 2. Step 01 — Connect (reference `3a`, mobile `4b` right card)
**Purpose:** OAuth both sides and pick a destination.

Header, sub-bar (`01` active), body `52px 40px 46px`, action bar, footer.
- H2 "Connect the two services"; lede (`56ch`): "We read your library from Spotify and write to the destination. Nothing is changed or deleted on the Spotify side."
- Two cards, `20px` gap, `26px` padding:

**Source card** — border `rgba(127,199,154,.4)` on `#141614`:
- 46px placeholder square + `Source` (mono eyebrow) + "Spotify" (Archivo 600 18px); right side "connected" in mono 500 11px `#7fc79a`.
- Detail list above a hairline (`22px` top, `18px` padding-top), Archivo 400 13px `rgba(255,255,255,.6)` label / `#f4f1eb` or mono 12px value: "Signed in as — marc@hey.com", "Access — read-only", "Found — 41 playlists · 5,318 songs".
- Text link: "Use a different account", Archivo 500 12.5px `rgba(255,255,255,.45)`, underline offset 3px.

**Destination card** — border `rgba(224,112,63,.5)` on `#1a1512`:
- `Destination` mono eyebrow in accent, then "Where is your library going?" Archivo 600 18px.
- Three provider rows, 1px gaps, `13px 14px`, 28px placeholder square + name:
  - **YouTube Music** — selected: accent border, `rgba(224,112,63,.12)` fill, Archivo 600 14px, right-aligned "chosen" mono 11px accent.
  - **Apple Music** and **Tidal** — **disabled**: `opacity:.45`, border `rgba(255,255,255,.07)`, name `rgba(255,255,255,.6)`, and a right-aligned `SOON` chip (mono 500 10px uppercase `.1em`, 1px `rgba(255,255,255,.25)` border, `3px 7px`, square). Not clickable; no hover.
- Primary CTA fills the card bottom: accent, `14px` padding, centered, "Sign in to YouTube Music".

Action bar (`20px 40px`, top hairline): left note "Free · we drop both tokens when the transfer finishes"; right button "Choose what to move" — **disabled** styling until the destination is authed: `rgba(255,255,255,.14)` fill, `rgba(255,255,255,.45)` text.

### 3. Step 02 — Choose (reference `3b`, mobile `4c` first card)
**Purpose:** select playlists, albums and followed artists to move.

- H2 "Choose what to move"; lede: "Spotify → YouTube Music. Uncheck anything you'd rather leave behind."
- Body grid `1fr 300px`, `24px` gap, `30px 40px 40px`.

**Left — selection table:**
- Tabs on a bottom hairline: active tab has 1px border on three sides, no bottom border, `#1a1917` fill, Archivo 600 12.5px, count in mono `rgba(255,255,255,.45)`. Tabs: `Playlists 41`, `Albums 168`, `Followed artists 312`.
- Toolbar row on `#0f0e0d`: "Select all" checkbox (checked) + right-aligned mono 11.5px "sort: recently played" (a control in the real build: recently played / name / size).
- Rows (1px-gap list, `14px 16px`): checkbox, 36px cover placeholder, title (Archivo 500 13.5px) + mono 11.5px subtitle, right-aligned mono 12px count.
  - `Liked songs` / "your saved library" / 2,911 songs — checked
  - `Deep Focus` / "by you · updated 2 days ago" / 312 songs — checked
  - `road trip '24` / "by you · 3 collaborators" / 91 songs — checked
  - `Discover Weekly` / "by Spotify · regenerates weekly" / 30 songs — **unchecked by default**, title and count dimmed
  - `kitchen sessions` / "by you · updated last month" / 204 songs — checked
  - `gym, reluctantly` / "by you · updated in March" / 78 songs — checked
  - Overflow row, mono 12px `rgba(255,255,255,.35)`: "+ 35 more playlists" (real build: virtualised list or paging)

**Right — summary panel** (`22px` on `#0f0e0d`, 1px border):
- `Selected` mono eyebrow; count mono 600 34px (`5,288`); "songs across 40 playlists" Archivo 12.5px.
- Above a hairline: Playlists "40 of 41", Saved albums "168 of 168", Followed artists "312 of 312", Estimated time "~4 min" (value in `#f4f1eb`).
- Primary CTA "Start the transfer" full width, `15px` padding.
- Note under it, Archivo 11.5px/1.5 `rgba(255,255,255,.42)`: "You can close the tab once it starts — the transfer keeps running."

Mobile: tabs shortened to `Playlists 41 / Albums / Artists`; toolbar shows "5,288 selected"; sticky bottom bar shows "40 playlists · 5,288 songs" + "~4 min" over the full-width CTA.

### 4. Step 03 — Transferring (reference `3c`, mobile `4c` second card)
**Purpose:** show progress, prove the job survives a reload, let the user fix unmatched songs.

- **Resume banner** directly under the sub-bar: `13px 40px` on `rgba(224,112,63,.1)` with a 1px `rgba(224,112,63,.28)` bottom border. "You can close this tab." in `#f0a58a` Archivo 500 12.5px, then "The transfer runs on our side — come back to this link any time to see where it got to." in `rgba(255,255,255,.6)`, then right-aligned mono 11.5px "sideload.app/t/8f21c · copy link" (real build: the job URL + a copy button with a copied confirmation).
- Progress header (`44px 40px 34px`): H2 "Transferring your library"; sub "3,304 of 5,288 songs moved to YouTube Music · about 2 minutes left"; right-aligned "62%" mono 600 44px accent.
- Segmented bar, 12px tall, `2px` gaps, weights 62 / 2 / 36 → accent / `#f0a58a` / `rgba(255,255,255,.12)`. Legend below in mono 11.5px with `■` swatches: "3,304 moved", "7 need review", "1,977 to go".
- **Activity** column (mono eyebrow label): 1px-bordered 1px-gap list.
  - Completed rows: title + "all 312 songs" in `#7fc79a`.
  - In-progress row: `#1a1917` background, title, a 180px 3px inline progress track (78% accent) under it, right-aligned "2,268 of 2,911".
  - Partial row: "88 of 91 · 3 to review" in `#f0a58a`.
  - Queued rows: dimmed title + "up next · 168".
- **Needs your review · 7** column: label in `#f0a58a` plus right-aligned "you can do this later". List bordered `rgba(240,165,138,.35)`; first item on `#1a1512`:
  - "Aphex Twin — Untitled" · playlist name in mono 11px right-aligned; reason "No exact match. Closest: "Untitled (Selected Ambient Works)""; action row `8px` gap: `Use closest` (1px `rgba(255,255,255,.3)` border, Archivo 500 11.5px, `7px 12px`), `Search manually` (dimmer border/text), `Skip` (underlined text link).
  - "Local file — demo_v3.mp3" / Liked songs — "Local files can't be transferred" (no actions).
  - "Bad Bunny — DtMF (remix)" / road trip '24 — "Not available on YouTube Music".
  - "+ 4 more" overflow row.
- Under the column: `Pause transfer` and `Download report` secondary buttons, `13px 20px`.

Mobile: banner becomes two stacked lines; progress % 34px beside a two-line summary; activity list keeps the inline progress row; the review queue collapses to a single tappable row — "7 songs need review" `#f0a58a` + "Review →" — followed by 50/50 `Pause` / `Report` buttons.

### 5. Done (reference `4a`, mobile `4c` third card)
**Purpose:** confirm success, surface leftovers, ask for a coffee.

Sub-bar shows all three steps complete, `03 Transfer ✓` in `#7fc79a`. Body `56px 40px 40px`, grid `1.15fr .85fr`, `44px` gap.

Left:
- Eyebrow mono 10px `.12em` `#7fc79a`: "Transfer complete · 6 min 12 s".
- H2 "Your library lives on YouTube Music now."
- Lede (`52ch`): "5,281 of 5,288 songs moved across 40 playlists, plus your albums and followed artists. Seven songs didn't exist on the other side — they're listed to the right so nothing goes missing quietly."
- Stat strip: single 1px-bordered row, four equal cells split by vertical hairlines, `20px 22px`: `5,281` songs moved, `40` playlists, `168` albums, `7` not found (value in `#f0a58a`).
- Actions: primary "Open YouTube Music" (accent, `16px 26px`), secondary "Download report (CSV)" (1px border, `15px 22px`), text link "Start another transfer".
- Coffee panel: 1px `rgba(224,112,63,.4)` on `#1a1512`, `22px 24px`, space-between — "Sideload is free, and stays free." (Archivo 600 15px) + "If it saved you an afternoon of copy-pasting, a coffee covers the server bill for the next few hundred transfers." (`46ch`) and a `#f4f1eb` button with `#141110` text, "Buy me a coffee".

Right:
- "Couldn't be moved · 7" label in `#f0a58a`, right-aligned "saved to your report".
- Same review-item list as step 3 (first item keeps `Use closest match` / `Search`), plus "Frank Ocean — Godspeed (live)" and "+ 3 more".
- Reassurance box under it, 1px `rgba(255,255,255,.12)`, `16px`, 12px/1.6 `rgba(255,255,255,.45)`: "Your Spotify library is untouched — nothing was deleted. Both connections were dropped when the transfer finished."

Mobile: stats become a 3-up strip (moved / playlists / not found), the two CTAs stack full-width, review collapses to "7 songs couldn't be moved" + "See list →", coffee panel stacks with a full-width button.

## Interactions & Behavior
States are **not** implemented in the prototype — build them:

- **Hover** (all clickable rows/buttons): lift the surface one step (`#121110` → `#1a1917`) or the border from `.12` → `.25` alpha; accent buttons darken ~6%. No radius change, no shadow, no transform. `transition: background-color 120ms ease, border-color 120ms ease`.
- **Focus-visible**: 2px accent outline, 2px offset. Never remove focus rings — the flow is checkbox-heavy and must be keyboard-operable (space toggles, shift-click range-selects in the list).
- **Disabled**: `opacity:.45`, `pointer-events:none`, `aria-disabled="true"` — as used for Apple Music / Tidal and the "Choose what to move" button before auth.
- **Navigation**: hero CTA → `/connect`; "Sign in to …" → provider OAuth, return to `/connect` with both cards connected, which enables "Choose what to move" → `/select`; "Start the transfer" creates a job and routes to `/t/:jobId`; on completion the same route renders the done screen.
- **Reload safety** is the core promise: `/t/:jobId` is shareable and bookmarkable; on load it fetches job state and renders whatever phase the job is in (running / paused / done / failed). Poll (2–3s) or subscribe via SSE/WebSocket. Progress must never jump backwards on reconnect.
- **Progress animation**: width transitions only, ~400ms ease-out, and only forwards. Counts tick to the new value rather than snapping if it's cheap; no spinners on the segmented bar.
- **Pause / resume**: `Pause transfer` → optimistic paused state, banner copy switches to paused wording, button becomes `Resume`.
- **Review actions**: `Use closest match` writes the suggested track and removes the item optimistically (with undo); `Search manually` opens an inline search field with results from the destination provider; `Skip` marks it skipped and keeps it in the CSV report.
- **Copy link**: copies the job URL, swaps the label to "copied" for ~1.5s.
- **Select all** is tri-state: all / none / indeterminate; unchecking a row moves it to indeterminate. "Discover Weekly"-style algorithmic playlists start unchecked.
- **Errors** (not yet designed — ask before inventing): token expired mid-transfer, destination rate limit (job auto-retries with backoff, banner explains the wait), provider outage, zero playlists found. Use `#f0a58a` for recoverable, and add a red-shifted variant of the accent for hard failures.
- **Responsive**: single desktop layout down to ~900px, then stack to the 390px mobile patterns — grids to one column, side panels become sticky bottom bars, two-column review/activity stack with review collapsed to a summary row. Hit targets ≥44px on mobile (mobile CTAs use `16–17px` vertical padding to satisfy this).

## State Management
Client state:
- `session`: `{ spotify: {connected, email, scope, counts}, destination: {provider, connected} }`
- `library`: playlists[], albums[], artists[] with `{ id, name, owner, updatedAt, trackCount, isAlgorithmic }`
- `selection`: `Set<id>` per tab + derived totals (`selectedTracks`, `selectedPlaylists`, `estimatedMinutes ≈ tracks / 1300`)
- `job`: `{ id, status: 'queued'|'running'|'paused'|'done'|'failed', movedCount, totalCount, unmatched[], perItem: [{id, name, moved, total, status}], startedAt, finishedAt }`
- `unmatched[]`: `{ id, title, artist, playlistName, reason: 'no_match'|'local_file'|'unavailable', suggestion?, resolution?: 'closest'|'manual'|'skipped' }`

Server/worker: jobs are persisted and processed out-of-process (queue + worker), keyed by `jobId`, so the client is a pure viewer of job state. Tokens are stored only for the life of the job and deleted on completion. Client fetches: library on entering step 2, job state on `/t/:jobId`.

## Assets
None real. Everything visual is a placeholder:
- Provider marks (Spotify, YouTube Music, Apple Music, Tidal) — dashed hatched squares, 26–46px. Use each provider's official mark within their brand guidelines.
- Playlist/album cover art — 34–36px dashed squares in list rows; use real artwork from the provider APIs.
- Hero "provider logo lockup" — ~118px placeholder block.
- Fonts: Archivo and IBM Plex Mono via Google Fonts (self-host in production).
- No icon set is used. If you add icons, prefer a thin, square-cornered set and keep them at `rgba(255,255,255,.45)`.

## Files
- `Sideload Final.dc.html` — **the design reference to build from.** Contains only the approved screens: hero, 01 Connect, 02 Choose, 03 Transferring, Done (desktop), plus the 390px mobile screens. Nothing in this file is exploratory.
