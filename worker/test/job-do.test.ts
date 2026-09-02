// worker/test/job-do.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, reset, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { fetchMock } from './fetch-mock';
import songs from './fixtures/innertube-search-songs.json';
import type { JobDO } from '../src/job-do';
import type { JobView } from '@shared/types';

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());
const music = () => fetchMock.get('https://music.youtube.com'); // anonymous search
const tv = () => fetchMock.get('https://www.youtube.com');        // TVHTML5 writes
const data = () => fetchMock.get('https://www.googleapis.com');   // Data API: create + read-back
const sp = () => fetchMock.get('https://api.spotify.com');
const SEARCH = { path: (p: string) => p.startsWith('/youtubei/v1/search'), method: 'POST' as const };
const CREATE = { path: (p: string) => p.startsWith('/youtube/v3/playlists?'), method: 'POST' as const };
const EDIT = { path: (p: string) => p.startsWith('/youtubei/v1/browse/edit_playlist'), method: 'POST' as const };
const q = (needle: string) => (b: unknown) => String(JSON.parse(String(b)).query ?? '').includes(needle); // match a search by its query (t1/t2 run in parallel)
const READBACK = { path: (p: string) => p.startsWith('/youtube/v3/playlistItems?'), method: 'GET' as const };
const pageOf = (vids: string[]) => ({ items: vids.map(videoId => ({ contentDetails: { videoId } })) });
let added: string[] = []; // videoIds the job sent to browse/edit_playlist — the read-back mock echoes them (D15)
const captureAdds = (opts: { body?: unknown }) => { added.push(...JSON.parse(String(opts.body)).actions.map((a: { addedVideoId: string }) => a.addedVideoId)); return { status: 'STATUS_SUCCEEDED' }; };
const entry = (id: string, name: string, extra: object = {}) => ({ added_at: '2024-01-01T00:00:00Z', is_local: false, item: { id, name, type: 'track', duration_ms: 293000, artists: [{ name: 'Aphex Twin' }], album: { name: 'SAW' }, ...extra } });
const payload = (id: string) => ({ id, spotify: { clientId: 'c'.repeat(32), access: 'SA', refresh: 'SR', expiresAt: Date.now() + 3600_000 }, google: { access: 'GA', refresh: 'GR', expiresAt: Date.now() + 3600_000 },
  selection: { liked: false, likedCount: 0, playlists: [{ id: 'P'.repeat(22), name: 'Deep Focus', description: null, isPublic: false, trackCount: 3 }], albums: [], artists: [] } });

// workerd fires due alarms on its own inside the vitest pool: start()/resume() kick off a real tick immediately.
// So: poll until the job settles, and use runDurableObjectAlarm ONLY to fast-forward alarms scheduled in the future
// (backoff, the 24 h expiry) — those are safe because no handler is in flight at that moment.
type Stub = DurableObjectStub<JobDO>;
const until = (stub: Stub, pred: (v: JobView) => boolean) => vi.waitFor(async () => { const v = await stub.view(); if (!v || !pred(v)) throw new Error(`not yet: ${v?.status}`); }, { timeout: 10_000, interval: 25 });
const settle = (stub: Stub) => until(stub, v => v.status === 'done' || v.status === 'failed');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('JobDO', () => {
  const id = 'job0000000000000000000001a';
  let stub: Stub;
  beforeEach(async () => { await reset(); stub = env.JOB.get(env.JOB.idFromName(id + Math.random())); added = []; }); // reset(): KV is shared across tests in this pool; the match cache must not leak between cases

  it('moves a playlist end to end, lists review items, wipes spotify tokens on finish', async () => {
    sp().intercept({ path: p => p.startsWith(`/v1/playlists/${'P'.repeat(22)}/items`) }).reply(200, { total: 3, next: null, items: [entry('t1', 'Xtal'), entry('t2', 'Nothing Will Match This Zzz'), { added_at: null, is_local: true, item: { id: null, name: 'demo_v3.mp3', type: 'track', duration_ms: 1000, artists: [{ name: 'me' }], is_local: true } }] });
    music().intercept({ ...SEARCH, body: q('Xtal') }).reply(200, songs);
    music().intercept({ ...SEARCH, body: q('Zzz') }).reply(200, { contents: {} }).times(2); // songs, then the videos fallback → nothing
    data().intercept(CREATE).reply(200, { id: 'PLnew' });
    tv().intercept(EDIT).reply(200, captureAdds);
    data().intercept(READBACK).reply(200, () => pageOf(added)); // verify pass sees everything → done
    await stub.start(payload(id));
    await settle(stub);
    const v = (await stub.view())!;
    expect(v.status).toBe('done');
    expect(v.items[0]).toMatchObject({ name: 'Deep Focus', status: 'done', ytId: 'PLnew', moved: 1, review: 2, total: 3 });
    expect(v.totals).toMatchObject({ tracks: 3, moved: 1, review: 2 });
    expect(v.review.map(r => r.reason).sort()).toEqual(['local_file', 'no_match'].sort());
    expect(v.ytConnected).toBe(true);
    await runInDurableObject(stub, (_, state) => { const row = state.storage.sql.exec('SELECT spotify_tokens, yt_tokens FROM job').one(); expect(row.spotify_tokens).toBeNull(); expect(row.yt_tokens).not.toBeNull(); });
    expect(await env.MATCH_CACHE.get('m1:aphex twin|xtal')).toMatch(/^[\w-]{11}$/);
  });

  it('backs off on throttling and resumes where it stopped', async () => {
    sp().intercept({ path: p => p.startsWith('/v1/playlists/') }).reply(200, { total: 1, next: null, items: [entry('t1', 'Xtal')] });
    music().intercept({ ...SEARCH, body: q('Xtal') }).reply(200, '<html>throttled</html>');
    await stub.start(payload(id));
    await until(stub, v => v.throttledUntil !== null); // one tick did fetch + first search → throttled → backoff alarm armed for +5 s
    expect((await stub.view())!.status).toBe('running');
    music().intercept({ ...SEARCH, body: q('Xtal') }).reply(200, songs);
    data().intercept(CREATE).reply(200, { id: 'PLnew' });
    tv().intercept(EDIT).reply(200, captureAdds);
    data().intercept(READBACK).reply(200, () => pageOf(added));
    await runInDurableObject(stub, (_, state) => state.storage.sql.exec('UPDATE job SET throttled_until = 0'));
    expect(await runDurableObjectAlarm(stub)).toBe(true); // fast-forward the backoff alarm (nothing in flight while throttled)
    await settle(stub);
    expect((await stub.view())!.status).toBe('done');
  });

  it('pause stops work; resume continues; resolve writes; disconnect wipes yt token', async () => {
    // No Spotify interceptor yet: the first native tick fails on the un-mocked fetch, re-arms +5 s, and the item is still `queued`.
    await stub.start(payload(id));
    await stub.pause();
    await sleep(50); // let the failing tick (if any) finish
    await runDurableObjectAlarm(stub); // whichever alarm is armed (retry or the 24 h expiry) → paused branch → re-arms expiry, moves nothing
    expect((await stub.view())!.status).toBe('paused');
    expect((await stub.view())!.items[0]!.status).toBe('queued');
    sp().intercept({ path: p => p.startsWith('/v1/playlists/') }).reply(200, { total: 1, next: null, items: [entry('t1', 'Nothing Will Match This Zzz')] });
    music().intercept({ ...SEARCH, body: q('Zzz') }).reply(200, { contents: {} }).times(2);
    data().intercept(CREATE).reply(200, { id: 'PLnew' }); // nothing matched → verify has nothing to read back → no READBACK mock needed
    await stub.resume();
    await settle(stub);
    const v = (await stub.view())!;
    expect(v.status).toBe('done'); expect(v.review.length).toBe(1);
    tv().intercept({ ...EDIT, body: b => JSON.parse(String(b)).actions[0].addedVideoId === 'abcdefghijk' }).reply(200, { status: 'STATUS_SUCCEEDED' });
    expect(await stub.resolve(v.review[0]!.id, { action: 'manual', videoId: 'abcdefghijk' })).toEqual({ ok: true });
    expect((await stub.view())!.totals.moved).toBe(1);
    await stub.disconnect();
    expect((await stub.view())!.ytConnected).toBe(false);
    expect(await stub.resolve(v.review[0]!.id, { action: 'skip' })).toEqual({ ok: false, error: 'not_reviewable' });
  });

  it('reads back after writing and re-drives a silent no-op until it converges (D15)', async () => {
    sp().intercept({ path: p => p.startsWith('/v1/playlists/') }).reply(200, { total: 1, next: null, items: [entry('t1', 'Xtal')] });
    music().intercept({ ...SEARCH, body: q('Xtal') }).reply(200, songs);
    data().intercept(CREATE).reply(200, { id: 'PLnew' });
    tv().intercept(EDIT).reply(200, captureAdds).times(2);              // first add "succeeds" but…
    data().intercept(READBACK).reply(200, pageOf([]));                     // …the read-back shows nothing (the measured failure mode)
    data().intercept(READBACK).reply(200, () => pageOf(added));            // after the re-drive it is there
    await stub.start(payload(id));
    await settle(stub);
    const v = (await stub.view())!;
    expect(v.status).toBe('done'); expect(v.totals.moved).toBe(1); expect(v.review.length).toBe(0);
    expect(added.length).toBe(2); // written twice
    await runInDurableObject(stub, (_, state) => { expect((state.storage.sql.exec('SELECT verify_passes FROM item').one() as { verify_passes: number }).verify_passes).toBe(2); });
  });

  it('gives up after MAX_VERIFY_PASSES and lists the song as write_failed', async () => {
    sp().intercept({ path: p => p.startsWith('/v1/playlists/') }).reply(200, { total: 1, next: null, items: [entry('t1', 'Xtal')] });
    music().intercept({ ...SEARCH, body: q('Xtal') }).reply(200, songs);
    data().intercept(CREATE).reply(200, { id: 'PLnew' });
    tv().intercept(EDIT).reply(200, captureAdds).times(4);
    data().intercept(READBACK).reply(200, pageOf([])).times(4);            // never shows up
    await stub.start(payload(id));
    await settle(stub);
    const v = (await stub.view())!;
    expect(v.status).toBe('done');
    expect(v.review[0]).toMatchObject({ reason: 'write_failed', actionable: true });
    expect(v.totals.writeFailed).toBe(1);
  });

  it('sends a collapsed match to review instead of silently merging it (D16)', async () => {
    // the measured case: the same song on two albums (two Spotify ids) → one YouTube video
    sp().intercept({ path: p => p.startsWith('/v1/playlists/') }).reply(200, { total: 2, next: null, items: [entry('t1', 'Xtal'), entry('t2', 'Xtal', { album: { name: 'Some Compilation' } })] });
    music().intercept({ ...SEARCH, body: q('Xtal') }).reply(200, songs).times(2); // both miss the cache at the same moment (parallel) and land on the same best video
    data().intercept(CREATE).reply(200, { id: 'PLnew' });
    tv().intercept(EDIT).reply(200, captureAdds);
    data().intercept(READBACK).reply(200, () => pageOf(added));
    await stub.start(payload(id));
    await settle(stub);
    const v = (await stub.view())!;
    expect(v.totals).toMatchObject({ moved: 1, review: 1, collapsed: 1 });
    expect(v.review[0]).toMatchObject({ reason: 'duplicate_match', collidesWith: 'Xtal' });
    expect(v.review[0]!.suggestion?.videoId).toMatch(/^[\w-]{11}$/); // "Use closest" adds it anyway
  });

  it('fails cleanly on expired YouTube auth and wipes both tokens', async () => {
    sp().intercept({ path: p => p.startsWith('/v1/playlists/') }).reply(200, { total: 1, next: null, items: [entry('t1', 'Xtal')] });
    music().intercept({ ...SEARCH, body: q('Xtal') }).reply(200, songs);
    data().intercept(CREATE).reply(401, { error: { code: 401, message: 'Invalid Credentials' } }); // token revoked: the first authenticated call fails
    await stub.start(payload(id));
    await settle(stub);
    const v = (await stub.view())!;
    expect(v.status).toBe('failed'); expect(v.failure).toBe('auth_expired'); expect(v.ytConnected).toBe(false);
  });

  it('rejects oversize selections up front', async () => {
    expect(await stub.start({ ...payload(id), selection: { liked: true, likedCount: 30000, playlists: [], albums: [], artists: [] } })).toEqual({ ok: false, error: 'too_large' });
    expect(await stub.view()).toBeNull();
  });
});
