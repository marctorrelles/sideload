// worker/test/innertube.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { fetchMock } from './fetch-mock';
import { InnerTube, parseSong, parseDuration, shelves, ThrottleError, AuthError, SEARCH_PARAMS, msUntilQuotaReset } from '../src/innertube';
import songs from './fixtures/innertube-search-songs.json';
import albums from './fixtures/innertube-search-albums.json';
import artists from './fixtures/innertube-search-artists.json';
import album from './fixtures/innertube-browse-album.json';
import edited from './fixtures/innertube-edit-playlist.json';
import liked from './fixtures/innertube-like.json';
import subscribed from './fixtures/innertube-subscribe.json';
import created from './fixtures/data-playlist-insert.json';
import items from './fixtures/data-playlist-items.json';
import itemsLL from './fixtures/data-playlist-items-ll.json';
beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());
const music = () => fetchMock.get('https://music.youtube.com');
const tv = () => fetchMock.get('https://www.youtube.com');
const data = () => fetchMock.get('https://www.googleapis.com');
const SEARCH = { path: (p: string) => p.startsWith('/youtubei/v1/search'), method: 'POST' as const };
const noAuth = (h: Record<string, string>) => !('authorization' in h);

describe('parsers (recorded fixtures)', () => {
  it('parses song results', () => {
    const r = shelves(songs).map(parseSong).filter(Boolean);
    expect(r.length).toBeGreaterThan(3);
    expect(r[0]!.videoId).toMatch(/^[\w-]{11}$/);
    expect(r[0]!.title.toLowerCase()).toContain('xtal');
    expect(r[0]!.artists.join(' ').toLowerCase()).toContain('aphex');
    expect(r[0]!.album?.toLowerCase()).toContain('selected ambient');
    expect(r[0]!.durationSec).toBeGreaterThan(200);
    expect(r[0]!.isSong).toBe(true);
  });
  it('does not throw on a result without artist links', () => {
    expect(() => parseSong({ playlistItemData: { videoId: 'abcdefghijk' }, flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'T' }] } } }] })).not.toThrow();
  });
  it('parseDuration', () => { expect(parseDuration('3:45')).toBe(225); expect(parseDuration('1:02:03')).toBe(3723); expect(parseDuration('Song')).toBeNull(); });
  it('msUntilQuotaReset is within a day', () => { const ms = msUntilQuotaReset(); expect(ms).toBeGreaterThan(60_000); expect(ms).toBeLessThanOrEqual(86_460_000); });
});

describe('client', () => {
  it('search is anonymous WEB_REMIX on music.youtube.com (no bearer, even with a token)', async () => {
    music().intercept({ ...SEARCH, headers: noAuth, body: b => { const j = JSON.parse(String(b)); return j.params === SEARCH_PARAMS.songs && j.context.client.clientName === 'WEB_REMIX'; } }).reply(200, songs);
    const r = await new InnerTube('T').searchSongs('Aphex Twin Xtal');
    expect(r.length).toBeGreaterThan(0);
  });
  it('albums, artists, album → playlist id', async () => {
    music().intercept(SEARCH).reply(200, albums);
    const a = await new InnerTube(null).searchAlbums('Aphex Twin Selected Ambient Works');
    expect(a[0]!.browseId).toMatch(/^MPRE/); expect(a[0]!.artists).toContain('Aphex Twin');
    music().intercept(SEARCH).reply(200, artists);
    expect((await new InnerTube(null).searchArtists('Aphex Twin'))[0]).toMatchObject({ channelId: expect.stringMatching(/^UC/), name: 'Aphex Twin' });
    music().intercept({ path: p => p.startsWith('/youtubei/v1/browse'), method: 'POST', headers: noAuth }).reply(200, album);
    expect(await new InnerTube(null).albumPlaylistId('MPREb_gaJgUErCmNd')).toMatch(/^OLAK5uy_/);
  });
  it('creates playlists through the Data API (the TV client cannot)', async () => {
    data().intercept({ path: '/youtube/v3/playlists?part=snippet,status', method: 'POST', headers: { authorization: 'Bearer T' }, body: b => { const j = JSON.parse(String(b)); return j.snippet.title === 'x' && j.status.privacyStatus === 'private'; } }).reply(200, created);
    expect(await new InnerTube('T').createPlaylist('x', '', 'PRIVATE')).toBe((created as any).id);
  });
  it('adds, likes, saves albums and subscribes through TVHTML5 with the bearer token', async () => {
    const withAuth = { authorization: 'Bearer T' };
    tv().intercept({ path: p => p.startsWith('/youtubei/v1/browse/edit_playlist'), method: 'POST', headers: withAuth, body: b => { const j = JSON.parse(String(b)); return j.actions.length === 2 && j.context.client.clientName === 'TVHTML5'; } }).reply(200, edited);
    await new InnerTube('T').addPlaylistItems('PL', ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    tv().intercept({ path: p => p.startsWith('/youtubei/v1/like/like'), method: 'POST', headers: withAuth, body: b => JSON.parse(String(b)).target.videoId === 'aaaaaaaaaaa' }).reply(200, liked);
    await new InnerTube('T').like('aaaaaaaaaaa');
    tv().intercept({ path: p => p.startsWith('/youtubei/v1/like/like'), method: 'POST', headers: withAuth, body: b => JSON.parse(String(b)).target.playlistId === 'OLAK5uy_x' }).reply(200, liked);
    await new InnerTube('T').likePlaylist('OLAK5uy_x');
    tv().intercept({ path: p => p.startsWith('/youtubei/v1/subscription/subscribe'), method: 'POST', headers: withAuth }).reply(200, subscribed);
    await new InnerTube('T').subscribe('UCx');
  });
  it('refuses writes without a token', async () => {
    await expect(new InnerTube(null).like('aaaaaaaaaaa')).rejects.toBeInstanceOf(AuthError);
    await expect(new InnerTube(null).createPlaylist('x', '', 'PRIVATE')).rejects.toBeInstanceOf(AuthError);
  });
  it('reads a playlist back across Data API pages (set semantics)', async () => {
    const page = (ids: string[], next?: string) => ({ items: ids.map(videoId => ({ contentDetails: { videoId } })), ...(next ? { nextPageToken: next } : {}) });
    data().intercept({ path: p => p.startsWith('/youtube/v3/playlistItems?') && p.includes('playlistId=PLx') && !p.includes('pageToken'), headers: { authorization: 'Bearer T' } }).reply(200, page(['aaaaaaaaaaa'], 'p2'));
    data().intercept({ path: p => p.startsWith('/youtube/v3/playlistItems?') && p.includes('pageToken=p2') }).reply(200, page(['bbbbbbbbbbb', 'aaaaaaaaaaa']));
    expect([...(await new InnerTube('T').playlistVideoIds('PLx'))].sort()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });
  it('parses the recorded read-back fixtures (LL = liked videos)', async () => {
    data().intercept({ path: p => p.includes('playlistId=PLYoHQq7hLMGg') }).reply(200, items);
    expect(await new InnerTube('T').playlistVideoIds('PLYoHQq7hLMGg')).toEqual(new Set(['sWcLccMuCA8']));
    data().intercept({ path: p => p.includes('playlistId=LL') && !p.includes('pageToken') }).reply(200, itemsLL);
    data().intercept({ path: p => p.includes('playlistId=LL') && p.includes('pageToken=') }).reply(200, { items: [] });
    expect((await new InnerTube('T').likedVideoIds()).size).toBe(3);
  });
  it('treats a hang as a retryable failure (D17)', async () => {
    music().intercept(SEARCH).reply(200, songs).delay(300);
    await expect(new InnerTube(null, { timeoutMs: 50 }).searchSongs('x')).rejects.toBeInstanceOf(ThrottleError);
  });
  it('maps InnerTube 401 → AuthError; 429/5xx/HTML-200/abuse-page-403 → ThrottleError', async () => {
    music().intercept(SEARCH).reply(401, {});
    await expect(new InnerTube(null).searchSongs('x')).rejects.toBeInstanceOf(AuthError);
    music().intercept(SEARCH).reply(200, '<html>Too many requests</html>');
    await expect(new InnerTube(null).searchSongs('x')).rejects.toBeInstanceOf(ThrottleError);
    music().intercept(SEARCH).reply(503, {});
    await expect(new InnerTube(null).searchSongs('x')).rejects.toBeInstanceOf(ThrottleError);
    music().intercept(SEARCH).reply(403, '<html><head><title>Sorry...</title></head></html>');
    await expect(new InnerTube(null).searchSongs('x')).rejects.toBeInstanceOf(ThrottleError);
    tv().intercept({ path: p => p.startsWith('/youtubei/v1/like/like'), method: 'POST' }).reply(403, { error: { code: 403, status: 'PERMISSION_DENIED' } });
    await expect(new InnerTube('T').like('aaaaaaaaaaa')).rejects.toBeInstanceOf(AuthError);
  });
  it('maps Data API quota → ThrottleError until the reset; 401/403 → AuthError', async () => {
    const q = { error: { code: 403, errors: [{ reason: 'quotaExceeded' }], message: 'quota' } };
    data().intercept({ path: p => p.startsWith('/youtube/v3/playlists'), method: 'POST' }).reply(403, q);
    const e = await new InnerTube('T').createPlaylist('x', '', 'PRIVATE').catch(e => e);
    expect(e).toBeInstanceOf(ThrottleError); expect((e as ThrottleError).retryAfterMs).toBeGreaterThan(60_000);
    data().intercept({ path: p => p.startsWith('/youtube/v3/playlistItems') }).reply(401, { error: { code: 401 } });
    await expect(new InnerTube('T').playlistVideoIds('PLx')).rejects.toBeInstanceOf(AuthError);
    data().intercept({ path: p => p.startsWith('/youtube/v3/playlistItems') }).reply(403, { error: { code: 403, errors: [{ reason: 'forbidden' }] } });
    await expect(new InnerTube('T').playlistVideoIds('PLx')).rejects.toBeInstanceOf(AuthError);
  });
});
