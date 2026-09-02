// worker/src/job-do.ts — one Durable Object per transfer. Alarm-driven ticks; every unit of work is persisted before the next await.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { seal, open } from './crypto';
import { Spotify, SpotifyError, toTrack, type Tokens } from './spotify';
import { refreshGoogle, GoogleError } from './google';
import { InnerTube, ThrottleError, AuthError } from './innertube';
import { buildQuery, cacheKey, pickBest, similarity } from './match';
import { toCsv } from './csv';
import type { JobView, JobItemView, ReviewItemView, ReviewAction, Selection, ManualSearchResult, ItemKind, ItemStatus, JobStatus, JobFailure, ReviewReason } from '@shared/types';

export interface StartPayload { id: string; spotify: Tokens; google: { access: string; refresh: string; expiresAt: number }; selection: Selection }

const TICK_BUDGET_MS = 50_000;     // wall-clock per alarm; CPU use is tiny, network wait dominates
const CONCURRENCY = 2;             // ponytail: per job. If logs show shared-IP throttling across jobs, add a global limiter DO.
const WRITE_BATCH = 100;
const MAX_VERIFY_PASSES = 3;      // measured: one pass fixed all 346 silent no-op likes; three is generous
const MAX_TRACKS = 25_000;
const JOB_TIMEOUT_MS = 24 * 3600_000;
const REVIEW_GRACE_MS = 24 * 3600_000; // D9
const RETENTION_MS = 7 * 24 * 3600_000;
const CACHE_TTL_S = 60 * 60 * 24 * 180;
const REVIEW_PAGE = 20;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
  spotify_tokens TEXT, yt_tokens TEXT, failure TEXT,
  attempt INTEGER NOT NULL DEFAULT 0, throttled_until INTEGER,
  searches INTEGER NOT NULL DEFAULT 0, cache_hits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS item (
  id TEXT PRIMARY KEY, ord INTEGER NOT NULL, kind TEXT NOT NULL, spotify_id TEXT, name TEXT NOT NULL, artist TEXT, description TEXT,
  is_public INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued',
  yt_id TEXT, reason TEXT, fetched INTEGER NOT NULL DEFAULT 0, fetch_offset INTEGER NOT NULL DEFAULT 0, verify_passes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS track (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, pos INTEGER NOT NULL, spotify_id TEXT,
  name TEXT NOT NULL, artists TEXT NOT NULL, album TEXT, duration_ms INTEGER, is_local INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', video_id TEXT, reason TEXT, suggestion TEXT, resolution TEXT,
  liked INTEGER NOT NULL DEFAULT 0, redo INTEGER NOT NULL DEFAULT 0, collides_with TEXT
);
CREATE INDEX IF NOT EXISTS track_item_status ON track(item_id, status, pos);
CREATE INDEX IF NOT EXISTS track_status ON track(status);`;

interface JobRow { id: string; status: JobStatus; created_at: number; started_at: number; finished_at: number | null; spotify_tokens: string | null; yt_tokens: string | null; failure: JobFailure | null; attempt: number; throttled_until: number | null; searches: number; cache_hits: number }
interface ItemRow { id: string; ord: number; kind: ItemKind; spotify_id: string | null; name: string; artist: string | null; description: string | null; is_public: number; total: number; status: ItemStatus; yt_id: string | null; reason: string | null; fetched: number; fetch_offset: number; verify_passes: number }
interface TrackRow { id: number; item_id: string; pos: number; spotify_id: string | null; name: string; artists: string; album: string | null; duration_ms: number | null; is_local: number; status: string; video_id: string | null; reason: ReviewReason | null; suggestion: string | null; resolution: string | null; liked: number; redo: number; collides_with: string | null }
const ids = (rows: { id: number }[]) => rows.map(() => '?').join(',');
class FatalError extends Error { constructor(public failure: JobFailure) { super(failure); } }
const VIDEO_ID = /^[\w-]{11}$/;

export class JobDO extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const stmt of SCHEMA.split(';')) if (stmt.trim()) this.sql.exec(stmt);
  }
  private job(): JobRow | null {
    try { return (this.sql.exec('SELECT * FROM job LIMIT 1').toArray()[0] as JobRow | undefined) ?? null; }
    catch { return null; } // after deleteAll() a still-resident instance has no tables: treat as gone (→ 404)
  }

  // ---------- RPC: lifecycle ----------
  /** Returns an error code instead of throwing: a throw inside an RPC method is also logged by workerd as an uncaught exception. */
  async start(p: StartPayload): Promise<{ ok: true } | { ok: false; error: 'already_started' | 'too_large' }> {
    if (this.job()) return { ok: false, error: 'already_started' };
    const s = p.selection;
    const expected = (s.liked ? s.likedCount : 0) + s.playlists.reduce((n, x) => n + x.trackCount, 0);
    if (expected > MAX_TRACKS) return { ok: false, error: 'too_large' };
    const now = Date.now();
    const [spot, yt] = await Promise.all([seal(this.env.TOKEN_SECRET, p.spotify), seal(this.env.TOKEN_SECRET, p.google)]);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO job (id, status, created_at, started_at, spotify_tokens, yt_tokens) VALUES (?,?,?,?,?,?)', p.id, 'running', now, now, spot, yt);
      let ord = 0;
      const add = (id: string, kind: ItemKind, name: string, extra: Partial<ItemRow> = {}) =>
        this.sql.exec('INSERT INTO item (id, ord, kind, spotify_id, name, artist, description, is_public, total) VALUES (?,?,?,?,?,?,?,?,?)', id, ord++, kind, extra.spotify_id ?? null, name, extra.artist ?? null, extra.description ?? null, extra.is_public ?? 0, extra.total ?? 0);
      if (s.liked) add('liked', 'liked', 'Liked songs', { total: s.likedCount });
      for (const pl of s.playlists) add(`pl:${pl.id}`, 'playlist', pl.name, { spotify_id: pl.id, description: pl.description, is_public: pl.isPublic ? 1 : 0, total: pl.trackCount });
      for (const al of s.albums) add(`al:${al.id}`, 'album', al.name, { spotify_id: al.id, artist: al.artist, total: 1 });
      for (const ar of s.artists) add(`ar:${ar.id}`, 'artist', ar.name, { spotify_id: ar.id, total: 1 });
    });
    await this.ctx.storage.setAlarm(now);
    return { ok: true };
  }
  async pause(): Promise<void> {
    this.sql.exec("UPDATE job SET status = 'paused' WHERE status = 'running'");
    const j = this.job();
    if (j?.status === 'paused') await this.ctx.storage.setAlarm(j.created_at + JOB_TIMEOUT_MS); // an abandoned pause still expires → tokens never outlive 24 h
  }
  async resume(): Promise<void> {
    this.sql.exec("UPDATE job SET status = 'running', throttled_until = NULL WHERE status = 'paused'");
    if (this.job()?.status === 'running') await this.ctx.storage.setAlarm(Date.now());
  }
  async disconnect(): Promise<void> { this.sql.exec('UPDATE job SET yt_tokens = NULL'); }

  // ---------- RPC: reads ----------
  async view(): Promise<JobView | null> {
    const j = this.job(); if (!j) return null;
    const items = (this.sql.exec('SELECT * FROM item ORDER BY ord').toArray() as unknown as ItemRow[]);
    const counts = new Map<string, { moved: number; review: number; matched: number; skipped: number }>();
    for (const r of this.sql.exec("SELECT item_id, status, COUNT(*) AS n FROM track GROUP BY item_id, status").toArray() as { item_id: string; status: string; n: number }[]) {
      const c = counts.get(r.item_id) ?? { moved: 0, review: 0, matched: 0, skipped: 0 };
      if (r.status in c) (c as any)[r.status] += r.n; counts.set(r.item_id, c);
    }
    const itemViews: JobItemView[] = items.map(i => {
      const c = counts.get(i.id) ?? { moved: 0, review: 0, matched: 0, skipped: 0 };
      const entityMoved = i.kind === 'album' || i.kind === 'artist' ? (i.status === 'done' ? 1 : 0) : c.moved;
      const entityReview = i.kind === 'album' || i.kind === 'artist' ? (i.status === 'failed' ? 1 : 0) : c.review;
      return { id: i.id, kind: i.kind, name: i.name, total: i.total, moved: entityMoved, review: entityReview, status: i.status, ytId: i.yt_id };
    });
    const byReason = Object.fromEntries((this.sql.exec("SELECT reason, COUNT(*) AS n FROM track WHERE status = 'review' GROUP BY reason").toArray() as { reason: string; n: number }[]).map(r => [r.reason, r.n]));
    const totals = itemViews.reduce((t, i) => ({ ...t, tracks: t.tracks + i.total, moved: t.moved + i.moved, review: t.review + i.review, skipped: t.skipped + (counts.get(i.id)?.skipped ?? 0) }), { tracks: 0, moved: 0, review: 0, skipped: 0, collapsed: byReason.duplicate_match ?? 0, writeFailed: byReason.write_failed ?? 0 });
    const elapsedMin = (Date.now() - j.started_at) / 60_000;
    const ratePerMin = j.searches >= 30 ? j.searches / elapsedMin : null;
    const remaining = Math.max(0, totals.tracks - totals.moved - totals.review - totals.skipped);
    return {
      id: j.id, status: j.status, failure: j.failure, totals, items: itemViews,
      review: this.reviewPage(0), reviewTotal: totals.review,
      startedAt: j.started_at, finishedAt: j.finished_at,
      ratePerMin, etaSeconds: ratePerMin && j.status === 'running' ? Math.round((remaining / ratePerMin) * 60) : null,
      throttledUntil: j.throttled_until && j.throttled_until > Date.now() ? j.throttled_until : null,
      ytConnected: !!j.yt_tokens, searches: j.searches, cacheHits: j.cache_hits,
    };
  }
  async review(offset: number): Promise<ReviewItemView[]> { return this.reviewPage(Math.max(0, offset | 0)); }
  private reviewPage(offset: number): ReviewItemView[] {
    const tracks = this.sql.exec(`SELECT t.*, i.name AS item_name, i.kind AS item_kind FROM track t JOIN item i ON i.id = t.item_id WHERE t.status = 'review' ORDER BY i.ord, t.pos LIMIT ? OFFSET ?`, REVIEW_PAGE, offset).toArray() as unknown as (TrackRow & { item_name: string; item_kind: ItemKind })[];
    const out: ReviewItemView[] = tracks.map(t => ({ id: t.id, kind: t.item_kind, title: t.name, artist: (JSON.parse(t.artists) as string[]).join(', '), itemName: t.item_name, reason: t.reason ?? 'no_match', suggestion: t.suggestion ? JSON.parse(t.suggestion) : null, collidesWith: t.collides_with, actionable: t.reason !== 'local_file' }));
    if (offset === 0) for (const i of this.sql.exec("SELECT * FROM item WHERE status = 'failed' ORDER BY ord").toArray() as unknown as ItemRow[])
      out.push({ id: -i.ord - 1, kind: i.kind, title: i.name, artist: i.artist ?? '', itemName: i.kind === 'album' ? 'Saved albums' : 'Followed artists', reason: 'no_match', suggestion: null, collidesWith: null, actionable: false });
    return out;
  }
  async reportCsv(): Promise<string> {
    const rows = this.sql.exec(`SELECT i.name AS item_name, i.kind, t.name, t.artists, t.album, t.status, t.reason, t.video_id, t.suggestion, t.resolution FROM track t JOIN item i ON i.id = t.item_id ORDER BY i.ord, t.pos`).toArray() as any[];
    const entities = this.sql.exec("SELECT kind, name, artist, status, reason, yt_id FROM item WHERE kind IN ('album','artist') ORDER BY ord").toArray() as any[];
    return toCsv([
      ['source', 'kind', 'title', 'artists', 'album', 'status', 'reason', 'youtube_id', 'suggested_title', 'resolution'],
      ...rows.map(r => [r.item_name, 'track', r.name, (JSON.parse(r.artists) as string[]).join('; '), r.album, r.status, r.reason, r.video_id, r.suggestion ? JSON.parse(r.suggestion).title : null, r.resolution]),
      ...entities.map(e => [e.kind === 'album' ? 'Saved albums' : 'Followed artists', e.kind, e.name, e.artist, null, e.status === 'done' ? 'moved' : e.status, e.reason, e.yt_id, null, null]),
    ]);
  }

  // ---------- RPC: review actions ----------
  async resolve(trackId: number, a: ReviewAction): Promise<{ ok: true } | { ok: false; error: 'not_reviewable' | 'disconnected' | 'bad_video' | 'no_suggestion' }> {
    const t = this.sql.exec('SELECT * FROM track WHERE id = ?', trackId).toArray()[0] as TrackRow | undefined;
    if (!t || t.status !== 'review' || t.reason === 'local_file') return { ok: false, error: 'not_reviewable' };
    if (a.action === 'skip') { this.sql.exec("UPDATE track SET status = 'skipped', resolution = 'skipped' WHERE id = ?", trackId); return { ok: true }; }
    const videoId = a.action === 'closest' ? (t.suggestion ? (JSON.parse(t.suggestion) as { videoId: string }).videoId : null) : a.videoId;
    if (!videoId) return { ok: false, error: 'no_suggestion' };
    if (!VIDEO_ID.test(videoId)) return { ok: false, error: 'bad_video' };
    const item = this.sql.exec('SELECT * FROM item WHERE id = ?', t.item_id).toArray()[0] as unknown as ItemRow;
    const job = this.job()!;
    if (!job.yt_tokens) return { ok: false, error: 'disconnected' };
    if (item.status === 'done' || item.status === 'writing') {
      const yt = await this.innertube(job);
      if (item.kind === 'liked') await yt.like(videoId); else await yt.addPlaylistItems(item.yt_id!, [videoId]);
      this.sql.exec("UPDATE track SET status = 'moved', video_id = ?, resolution = ? WHERE id = ?", videoId, a.action, trackId);
    } else {
      this.sql.exec("UPDATE track SET status = 'matched', video_id = ?, resolution = ? WHERE id = ?", videoId, a.action, trackId); // the normal write path will add it
    }
    return { ok: true };
  }
  async search(q: string): Promise<ManualSearchResult[] | null> {
    const job = this.job(); if (!job?.yt_tokens) return null;
    const yt = await this.innertube(job);
    return (await yt.searchSongs(q.slice(0, 200))).filter(r => !r.unavailable).slice(0, 8).map(r => ({ videoId: r.videoId, title: r.title, artists: r.artists.join(', '), album: r.album, durationSec: r.durationSec }));
  }

  // ---------- alarm ----------
  async alarm(): Promise<void> {
    const job = this.job(); if (!job) return;
    if (job.status === 'running') return this.tick(job);
    if (job.status === 'paused') { // resume() re-arms the work loop; here we only enforce the 24 h expiry
      if (Date.now() - job.created_at > JOB_TIMEOUT_MS) return this.fail('timeout');
      return this.ctx.storage.setAlarm(job.created_at + JOB_TIMEOUT_MS);
    }
    const finished = job.finished_at ?? Date.now();
    if (Date.now() < finished + REVIEW_GRACE_MS) return this.ctx.storage.setAlarm(finished + REVIEW_GRACE_MS);
    if (job.yt_tokens) this.sql.exec('UPDATE job SET yt_tokens = NULL');
    if (Date.now() < finished + RETENTION_MS) return this.ctx.storage.setAlarm(finished + RETENTION_MS);
    await this.ctx.storage.deleteAll();
  }
  private async tick(job: JobRow): Promise<void> {
    const now = Date.now();
    if (job.throttled_until && job.throttled_until > now) return this.ctx.storage.setAlarm(job.throttled_until);
    if (now - job.created_at > JOB_TIMEOUT_MS) return this.fail('timeout');
    const deadline = now + TICK_BUDGET_MS;
    try {
      const [yt, sp] = await Promise.all([this.innertube(job), this.spotify(job)]);
      while (Date.now() < deadline) {
        if (this.job()?.status !== 'running') return; // paused mid-tick
        if (await this.step(sp, yt)) return this.finish();
      }
      this.sql.exec('UPDATE job SET attempt = 0, throttled_until = NULL');
      await this.ctx.storage.setAlarm(Date.now());
    } catch (e) { await this.handleError(e, job); }
  }
  /** One unit of work on the first unfinished item. True when everything is done. */
  private async step(sp: Spotify, yt: InnerTube): Promise<boolean> {
    const item = this.sql.exec("SELECT * FROM item WHERE status NOT IN ('done','failed') ORDER BY ord LIMIT 1").toArray()[0] as ItemRow | undefined;
    if (!item) return true;
    if (item.kind === 'album' || item.kind === 'artist') { await this.moveEntity(item, yt); return false; }
    if (!item.fetched) { await this.fetchPage(item, sp); return false; }
    const pending = this.sql.exec("SELECT * FROM track WHERE item_id = ? AND status = 'pending' ORDER BY pos LIMIT ?", item.id, CONCURRENCY).toArray() as unknown as TrackRow[];
    if (pending.length) { await this.matchBatch(pending, yt); return false; }
    if (item.status === 'verifying') { await (this.hasRedo(item) ? this.redrive(item, yt) : this.verifyItem(item, yt)); return false; }
    await this.writeBatch(item, yt);
    return false;
  }
  private hasRedo(item: ItemRow): boolean { return (this.sql.exec('SELECT COUNT(*) AS n FROM track WHERE item_id = ? AND redo > 0', item.id).one() as { n: number }).n > 0; }
  private async fetchPage(item: ItemRow, sp: Spotify): Promise<void> {
    const page = item.kind === 'liked' ? await sp.savedTracks(item.fetch_offset) : await sp.playlistItems(item.spotify_id!, item.fetch_offset);
    const done = !page.next || page.items.length === 0;
    this.ctx.storage.transactionSync(() => {
      page.items.forEach((raw, i) => {
        const t = toTrack(raw);
        if (!t || t.isEpisode) return; // podcasts: unsupported, not listed
        this.sql.exec('INSERT INTO track (item_id, pos, spotify_id, name, artists, album, duration_ms, is_local, status, reason) VALUES (?,?,?,?,?,?,?,?,?,?)',
          item.id, item.fetch_offset + i, t.id, t.name, JSON.stringify(t.artists), t.album, t.durationMs, t.isLocal ? 1 : 0, t.isLocal ? 'review' : 'pending', t.isLocal ? 'local_file' : null);
      });
      const count = (this.sql.exec('SELECT COUNT(*) AS n FROM track WHERE item_id = ?', item.id).one() as { n: number }).n;
      // `total` only grows while fetching (the headline % must never run backwards); the last page sets the exact count (episodes were skipped)
      this.sql.exec('UPDATE item SET fetch_offset = ?, fetched = ?, status = ?, total = ? WHERE id = ?', item.fetch_offset + page.items.length, done ? 1 : 0, done ? 'matching' : 'fetching', done ? count : Math.max(item.total, count), item.id);
    });
    if ((this.sql.exec('SELECT COUNT(*) AS n FROM track').one() as { n: number }).n > MAX_TRACKS) throw new FatalError('too_large');
  }
  private async matchBatch(tracks: TrackRow[], yt: InnerTube): Promise<void> {
    const results = await Promise.all(tracks.map(t => this.matchOne(t, yt)));
    this.ctx.storage.transactionSync(() => {
      for (const r of results) {
        let { status, reason, suggestion } = r;
        let collidesWith: string | null = null;
        if (status === 'matched') {
          // D16: collapsed matches. Measured: 451 of 3,036 liked tracks landed on a video another track already used (remixes, live takes, re-releases).
          const other = this.sql.exec("SELECT name FROM track WHERE item_id = ? AND video_id = ? AND id != ? AND COALESCE(spotify_id, '') != COALESCE(?, '') AND status IN ('matched', 'moved') LIMIT 1", r.itemId, r.videoId, r.id, r.spotifyId).toArray()[0] as { name: string } | undefined;
          if (other) { status = 'review'; reason = 'duplicate_match'; collidesWith = other.name; suggestion = JSON.stringify({ videoId: r.videoId, title: `the same video as "${other.name}"`, artists: '' }); }
        }
        this.sql.exec('UPDATE track SET status = ?, video_id = ?, reason = ?, suggestion = ?, collides_with = ? WHERE id = ?', status, status === 'matched' ? r.videoId : null, reason ?? null, suggestion ?? null, collidesWith, r.id);
        this.sql.exec('UPDATE job SET searches = searches + ?, cache_hits = cache_hits + ?', r.searched ? 1 : 0, r.hit ? 1 : 0);
      }
    });
  }
  private async matchOne(t: TrackRow, yt: InnerTube): Promise<{ id: number; itemId: string; spotifyId: string | null; status: 'matched' | 'review'; videoId?: string; reason?: ReviewReason; suggestion?: string; searched: boolean; hit: boolean }> {
    const base = { id: t.id, itemId: t.item_id, spotifyId: t.spotify_id };
    const st = { name: t.name, artists: JSON.parse(t.artists) as string[], album: t.album ?? '', durationMs: t.duration_ms ?? 0 };
    const key = 'm1:' + cacheKey(st);
    const cached = await this.env.MATCH_CACHE.get(key);
    if (cached) return { ...base, status: 'matched', videoId: cached, searched: false, hit: true };
    const q = buildQuery(st);
    let results = await yt.searchSongs(q, 'songs');
    if (!results.some(r => !r.unavailable)) results = [...results, ...(await yt.searchSongs(q, 'videos'))];
    const m = pickBest(st, results);
    if (m.best && m.confident) {
      await this.env.MATCH_CACHE.put(key, m.best.videoId, { expirationTtl: CACHE_TTL_S }); // awaited: tests assert on it, and it is one cheap write
      return { ...base, status: 'matched', videoId: m.best.videoId, searched: true, hit: false };
    }
    if (m.best) return { ...base, status: 'review', reason: 'low_confidence', suggestion: JSON.stringify({ videoId: m.best.videoId, title: m.best.title, artists: m.best.artists.join(', ') }), searched: true, hit: false };
    return { ...base, status: 'review', reason: results.length && results.every(r => r.unavailable) ? 'unavailable' : 'no_match', searched: true, hit: false };
  }
  private async writeBatch(item: ItemRow, yt: InnerTube): Promise<void> {
    if (!item.yt_id) {
      // D18: liked songs get a private "Liked Songs" mirror playlist (order preserved, shareable, verifiable) plus the individual likes below.
      const title = item.kind === 'liked' ? 'Liked Songs' : item.name;
      const description = item.kind === 'liked' ? 'Your Spotify liked songs, moved with Sideload.' : item.description ?? '';
      const ytId = await yt.createPlaylist(title, description, item.is_public ? 'PUBLIC' : 'PRIVATE');
      this.sql.exec("UPDATE item SET yt_id = ?, status = 'writing' WHERE id = ?", ytId, item.id);
      return;
    }
    const batch = this.sql.exec("SELECT id, video_id FROM track WHERE item_id = ? AND status = 'matched' ORDER BY pos ASC LIMIT ?", item.id, WRITE_BATCH).toArray() as { id: number; video_id: string }[];
    if (batch.length) {
      await yt.addPlaylistItems(item.yt_id, batch.map(b => b.video_id));
      this.sql.exec(`UPDATE track SET status = 'moved' WHERE id IN (${ids(batch)})`, ...batch.map(b => b.id));
      return;
    }
    if (item.kind === 'liked') {
      // Spotify lists newest first; like oldest first so YouTube's "Liked Music" (sorted by like time) ends up the same way round.
      const likes = this.sql.exec("SELECT id, video_id FROM track WHERE item_id = ? AND status = 'moved' AND liked = 0 ORDER BY pos DESC LIMIT ?", item.id, CONCURRENCY).toArray() as { id: number; video_id: string }[];
      if (likes.length) {
        await Promise.all(likes.map(l => yt.like(l.video_id)));
        this.sql.exec(`UPDATE track SET liked = 1 WHERE id IN (${ids(likes)})`, ...likes.map(l => l.id));
        return;
      }
    }
    this.sql.exec("UPDATE item SET status = 'verifying' WHERE id = ?", item.id); // nothing left to write → read back before calling it done (D15)
  }
  /**
   * D15. Measured: 346 of 2,585 like calls returned success and silently did nothing. Never trust a 200 — read back, mark the diff
   * for re-drive (`redo` 1 = missing from playlist, 2 = missing like), converge. Track status never flips back, so progress never runs backwards.
   */
  private async verifyItem(item: ItemRow, yt: InnerTube): Promise<void> {
    const moved = this.sql.exec("SELECT id, video_id, liked FROM track WHERE item_id = ? AND status = 'moved'", item.id).toArray() as { id: number; video_id: string; liked: number }[];
    const finishItem = () => this.sql.exec("UPDATE item SET status = 'done' WHERE id = ?", item.id);
    if (!moved.length) return void finishItem();
    const inPlaylist = await yt.playlistVideoIds(item.yt_id!);
    const missingAdds = moved.filter(t => !inPlaylist.has(t.video_id));
    const likedSet = item.kind === 'liked' ? await yt.likedVideoIds() : null;
    const missingLikes = likedSet ? moved.filter(t => t.liked && !likedSet.has(t.video_id)) : [];
    const passes = item.verify_passes + 1;
    console.log(JSON.stringify({ evt: 'verify', kind: item.kind, pass: passes, moved: moved.length, missingAdds: missingAdds.length, missingLikes: missingLikes.length }));
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('UPDATE item SET verify_passes = ? WHERE id = ?', passes, item.id);
      if (!missingAdds.length && !missingLikes.length) return void finishItem();
      if (passes <= MAX_VERIFY_PASSES) { // mark for re-drive; the next steps write them and we verify again
        if (missingAdds.length) this.sql.exec(`UPDATE track SET redo = 1 WHERE id IN (${ids(missingAdds)})`, ...missingAdds.map(t => t.id));
        if (missingLikes.length) this.sql.exec(`UPDATE track SET redo = 2 WHERE id IN (${ids(missingLikes)})`, ...missingLikes.map(t => t.id));
        return;
      }
      // gave up: songs missing from the playlist go to review so the user can retry by hand; missing likes are logged (the mirror playlist still has them)
      for (const t of missingAdds) this.sql.exec("UPDATE track SET status = 'review', reason = 'write_failed', suggestion = ? WHERE id = ?", JSON.stringify({ videoId: t.video_id, title: 'the same video, added again', artists: '' }), t.id);
      finishItem();
    });
  }
  private async redrive(item: ItemRow, yt: InnerTube): Promise<void> {
    const adds = this.sql.exec('SELECT id, video_id FROM track WHERE item_id = ? AND redo = 1 ORDER BY pos ASC LIMIT ?', item.id, WRITE_BATCH).toArray() as { id: number; video_id: string }[];
    if (adds.length) {
      await yt.addPlaylistItems(item.yt_id!, adds.map(a => a.video_id));
      this.sql.exec(`UPDATE track SET redo = 0 WHERE id IN (${ids(adds)})`, ...adds.map(a => a.id));
      return;
    }
    const likes = this.sql.exec('SELECT id, video_id FROM track WHERE item_id = ? AND redo = 2 ORDER BY pos DESC LIMIT ?', item.id, CONCURRENCY).toArray() as { id: number; video_id: string }[];
    if (likes.length) {
      await Promise.all(likes.map(l => yt.like(l.video_id)));
      this.sql.exec(`UPDATE track SET redo = 0 WHERE id IN (${ids(likes)})`, ...likes.map(l => l.id));
    }
  }
  private async moveEntity(item: ItemRow, yt: InnerTube): Promise<void> {
    this.sql.exec("UPDATE item SET status = 'writing' WHERE id = ?", item.id);
    const fail = () => this.sql.exec("UPDATE item SET status = 'failed', reason = 'no_match' WHERE id = ?", item.id);
    if (item.kind === 'artist') {
      const best = (await yt.searchArtists(item.name)).find(h => similarity(h.name, item.name) >= 0.8);
      if (!best) return void fail();
      await yt.subscribe(best.channelId);
      this.sql.exec("UPDATE item SET status = 'done', yt_id = ? WHERE id = ?", best.channelId, item.id);
    } else {
      const best = (await yt.searchAlbums(`${item.artist ?? ''} ${item.name}`.trim())).find(h => similarity(h.title, item.name) >= 0.7 && (!item.artist || similarity(h.artists.join(' '), item.artist) >= 0.5));
      const pl = best ? await yt.albumPlaylistId(best.browseId) : null;
      if (!pl) return void fail();
      await yt.likePlaylist(pl);
      this.sql.exec("UPDATE item SET status = 'done', yt_id = ? WHERE id = ?", pl, item.id);
    }
  }
  private async finish(): Promise<void> {
    const v = (await this.view())!;
    this.sql.exec("UPDATE job SET status = 'done', finished_at = ?, spotify_tokens = NULL, throttled_until = NULL", Date.now());
    await this.ctx.storage.setAlarm(Date.now() + REVIEW_GRACE_MS);
    this.ctx.waitUntil(this.env.STATS.get(this.env.STATS.idFromName('global')).add({ moved: v.totals.moved, total: v.totals.tracks, seconds: Math.round((Date.now() - v.startedAt) / 1000) }).catch(() => {}));
    const passes = (this.sql.exec('SELECT COALESCE(SUM(verify_passes), 0) AS n FROM item').one() as { n: number }).n;
    console.log(JSON.stringify({ evt: 'job_done', job: v.id.slice(0, 6), ...v.totals, verifyPasses: passes, searches: v.searches, cacheHits: v.cacheHits, seconds: Math.round((Date.now() - v.startedAt) / 1000) }));
  }
  private async fail(failure: JobFailure): Promise<void> {
    this.sql.exec("UPDATE job SET status = 'failed', failure = ?, finished_at = ?, spotify_tokens = NULL, yt_tokens = NULL", failure, Date.now());
    console.log(JSON.stringify({ evt: 'job_failed', failure }));
    await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS);
  }
  private async handleError(e: unknown, job: JobRow): Promise<void> {
    const attempt = job.attempt + 1;
    if (e instanceof ThrottleError || (e instanceof SpotifyError && e.status === 429)) {
      const wait = e instanceof SpotifyError ? e.retryAfter * 1000 : e.retryAfterMs ?? Math.min(5_000 * 2 ** (attempt - 1), 600_000); // retryAfterMs: Data API daily quota → next midnight Pacific
      this.sql.exec('UPDATE job SET attempt = ?, throttled_until = ?', attempt, Date.now() + wait);
      console.log(JSON.stringify({ evt: 'throttle', job: job.id.slice(0, 6), attempt, wait, err: String(e).slice(0, 200) }));
      return this.ctx.storage.setAlarm(Date.now() + wait);
    }
    if (e instanceof AuthError || e instanceof GoogleError || (e instanceof SpotifyError && e.status === 401)) return this.fail('auth_expired');
    if (e instanceof FatalError) return this.fail(e.failure);
    console.error(JSON.stringify({ evt: 'tick_error', job: job.id.slice(0, 6), attempt, err: String(e).slice(0, 300) }));
    if (attempt > 8) return this.fail('provider_error');
    this.sql.exec('UPDATE job SET attempt = ?', attempt);
    await this.ctx.storage.setAlarm(Date.now() + 5_000 * attempt);
  }

  // ---------- clients with transparent refresh ----------
  private async innertube(job: JobRow): Promise<InnerTube> {
    const g = await open<{ access: string; refresh: string; expiresAt: number }>(this.env.TOKEN_SECRET, job.yt_tokens ?? '');
    if (!g) throw new AuthError();
    if (g.expiresAt - Date.now() < 180_000) {
      const r = await refreshGoogle(this.env.GOOGLE_CLIENT_ID, this.env.GOOGLE_CLIENT_SECRET, g.refresh);
      Object.assign(g, r);
      this.sql.exec('UPDATE job SET yt_tokens = ?', await seal(this.env.TOKEN_SECRET, g));
    }
    return new InnerTube(g.access);
  }
  private async spotify(job: JobRow): Promise<Spotify> {
    const t = await open<Tokens>(this.env.TOKEN_SECRET, job.spotify_tokens ?? '');
    if (!t) throw new SpotifyError(401, 'auth_expired');
    return new Spotify(t, async nt => { this.sql.exec('UPDATE job SET spotify_tokens = ?', await seal(this.env.TOKEN_SECRET, nt)); });
  }
}
