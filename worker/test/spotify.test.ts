// worker/test/spotify.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { fetchMock } from './fetch-mock';
import { authorizeUrl, Spotify, toTrack, SpotifyError } from '../src/spotify';
import items from './fixtures/spotify-playlist-items.json';
import playlists from './fixtures/spotify-me-playlists.json';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());
const tokens = { access: 'A', refresh: 'R', expiresAt: Date.now() + 3600_000, clientId: 'c'.repeat(32) };

describe('spotify', () => {
  it('builds a PKCE authorize url', () => {
    const u = new URL(
      authorizeUrl({
        clientId: 'c'.repeat(32),
        redirectUri: 'http://127.0.0.1:4321/auth/spotify/callback',
        state: 's',
        challenge: 'ch',
      }),
    );
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toContain('playlist-read-private');
    expect(u.searchParams.get('client_secret')).toBeNull();
  });
  it('maps playlist entries using the item wrapper, flags local files and episodes', () => {
    const tracks = (items as any).items.map(toTrack).filter(Boolean);
    expect(tracks.length).toBeGreaterThan(0);
    for (const t of tracks) {
      expect(t.name).toBeTruthy();
      expect(Array.isArray(t.artists)).toBe(true);
    }
    expect(
      toTrack({
        added_at: null,
        is_local: true,
        item: {
          id: null,
          name: 'demo_v3',
          type: 'track',
          duration_ms: 1000,
          artists: [{ name: 'me' }],
          is_local: true,
        },
      })!.isLocal,
    ).toBe(true);
    expect(
      toTrack({ added_at: null, is_local: false, item: { id: 'x', name: 'Ep 1', type: 'episode', duration_ms: 1000 } })!
        .isEpisode,
    ).toBe(true);
    expect(toTrack({ added_at: null, is_local: false, item: null })).toBeNull();
  });
  it('refreshes an expiring token before calling and persists it', async () => {
    let saved: any = null;
    const sp = new Spotify({ ...tokens, expiresAt: Date.now() + 10_000 }, async (t) => {
      saved = t;
    });
    fetchMock
      .get('https://accounts.spotify.com')
      .intercept({ path: '/api/token', method: 'POST' })
      .reply(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 });
    fetchMock
      .get('https://api.spotify.com')
      .intercept({ path: '/v1/me/playlists?limit=50', headers: { authorization: 'Bearer A2' } })
      .reply(200, playlists);
    const p = await sp.playlists();
    expect(p.items.length).toBeGreaterThan(0);
    expect(saved.refresh).toBe('R2');
  });
  it('surfaces 429 with retry-after', async () => {
    fetchMock
      .get('https://api.spotify.com')
      .intercept({ path: '/v1/me/tracks?limit=50&offset=0' })
      .reply(429, '', { headers: { 'retry-after': '7' } });
    await expect(new Spotify(tokens, async () => {}).savedTracks(0)).rejects.toMatchObject({
      status: 429,
      retryAfter: 7,
    } satisfies Partial<SpotifyError>);
  });
});
