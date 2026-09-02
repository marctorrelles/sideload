// worker/test/innertube.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { fetchMock } from './fetch-mock';
import { InnerTube, parseSong, parseDuration, parsePlaylistPage, shelves, ThrottleError, AuthError, SEARCH_PARAMS } from '../src/innertube';
import browsePlaylist from './fixtures/innertube-browse-playlist-big.json';
import songs from './fixtures/innertube-search-songs.json';
import albums from './fixtures/innertube-search-albums.json';
import artists from './fixtures/innertube-search-artists.json';
import album from './fixtures/innertube-browse-album.json';
import created from './fixtures/innertube-playlist-create.json';
beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
const yt = () => fetchMock.get('https://music.youtube.com');

describe('parsers', () => {
  it('parses song results from the recorded fixture', () => {
    const r = shelves(songs).map(parseSong).filter(Boolean);
    expect(r.length).toBeGreaterThan(3);
    expect(r[0]!.videoId).toMatch(/^[\w-]{11}$/);
    expect(r[0]!.title.toLowerCase()).toContain('xtal');
    expect(r[0]!.artists.join(' ').toLowerCase()).toContain('aphex');
    expect(r[0]!.durationSec).toBeGreaterThan(200);
    expect(r[0]!.isSong).toBe(true);
    expect(r.some(x => x!.unavailable)).toBe(true); // greyed-out rows are flagged, not dropped
  });
  it('does not throw on a result without artist links', () => {
    expect(() => parseSong({ playlistItemData: { videoId: 'abcdefghijk' }, flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'T' }] } } }] })).not.toThrow();
  });
  it('parseDuration', () => { expect(parseDuration('3:45')).toBe(225); expect(parseDuration('1:02:03')).toBe(3723); expect(parseDuration('Song')).toBeNull(); });
});
describe('client', () => {
  it('search posts WEB_REMIX context + params and bearer', async () => {
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/search'), method: 'POST', headers: { authorization: 'Bearer T' }, body: b => { const j = JSON.parse(String(b)); return j.params === SEARCH_PARAMS.songs && j.context.client.clientName === 'WEB_REMIX'; } }).reply(200, songs);
    const r = await new InnerTube('T').searchSongs('Aphex Twin Xtal');
    expect(r.length).toBeGreaterThan(0);
  });
  it('albums/artists/browse/create/add/like/subscribe', async () => {
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/search'), method: 'POST' }).reply(200, albums);
    const a = await new InnerTube('T').searchAlbums('Aphex Twin Selected Ambient Works');
    expect(a[0]!.browseId).toMatch(/^MPRE/);
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/search'), method: 'POST' }).reply(200, artists);
    expect((await new InnerTube('T').searchArtists('Aphex Twin'))[0]!.channelId).toMatch(/^UC/);
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/browse'), method: 'POST' }).reply(200, album);
    expect(await new InnerTube('T').albumPlaylistId('MPREx')).toMatch(/^OLAK5uy_/);
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/playlist/create'), method: 'POST' }).reply(200, created);
    expect(await new InnerTube('T').createPlaylist('x', '', 'PRIVATE')).toBe((created as any).playlistId);
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/browse/edit_playlist'), method: 'POST', body: b => JSON.parse(String(b)).actions.length === 2 }).reply(200, { status: 'STATUS_SUCCEEDED' });
    await new InnerTube('T').addPlaylistItems('PL', ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/like/like'), method: 'POST' }).reply(200, {});
    await new InnerTube('T').like('aaaaaaaaaaa');
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/subscription/subscribe'), method: 'POST' }).reply(200, {});
    await new InnerTube('T').subscribe('UCx');
  });
  it('reads a playlist back across continuations (set semantics)', async () => {
    const row = (v: string) => ({ musicResponsiveListItemRenderer: { playlistItemData: { videoId: v } } });
    const page = (ids: string[], token?: string) => ({ contents: { x: { musicPlaylistShelfRenderer: { contents: [...ids.map(row), ...(token ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } }] : [])] } } } });
    const cont = (ids: string[]) => ({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: ids.map(row) } }] });
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/browse'), method: 'POST', body: b => JSON.parse(String(b)).browseId === 'VLPLx' }).reply(200, page(['aaaaaaaaaaa'], 'tok1'));
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/browse'), method: 'POST', body: b => JSON.parse(String(b)).continuation === 'tok1' }).reply(200, cont(['bbbbbbbbbbb', 'aaaaaaaaaaa']));
    expect([...(await new InnerTube('T').playlistVideoIds('PLx'))].sort()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });
  it('parses the recorded read-back fixture', () => {
    const p = parsePlaylistPage(browsePlaylist);
    expect(p.videoIds.length).toBeGreaterThan(50); expect(p.continuation).toBeTruthy();
  });
  it('treats a hang as a retryable failure (D17)', async () => {
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/search'), method: 'POST' }).reply(200, songs).delay(300);
    await expect(new InnerTube('T', { timeoutMs: 50 }).searchSongs('x')).rejects.toBeInstanceOf(ThrottleError);
  });
  it('maps 401 → AuthError, 429/5xx/HTML → ThrottleError', async () => {
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/search'), method: 'POST' }).reply(401, {});
    await expect(new InnerTube('T').searchSongs('x')).rejects.toBeInstanceOf(AuthError);
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/search'), method: 'POST' }).reply(200, '<html>Too many requests</html>');
    await expect(new InnerTube('T').searchSongs('x')).rejects.toBeInstanceOf(ThrottleError);
    yt().intercept({ path: p => p.startsWith('/youtubei/v1/search'), method: 'POST' }).reply(503, {});
    await expect(new InnerTube('T').searchSongs('x')).rejects.toBeInstanceOf(ThrottleError);
  });
});
