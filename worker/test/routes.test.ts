// worker/test/routes.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { fetchMock } from './fetch-mock';
import me from './fixtures/spotify-me.json';
beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
const post = (path: string, body?: unknown, cookie = '') => SELF.fetch(`http://127.0.0.1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]!;

describe('routes', () => {
  it('rejects cross-site POSTs', async () => {
    const r = await SELF.fetch('http://127.0.0.1/auth/spotify/start', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(403);
  });
  it('validates the client id and returns a PKCE url with state cookie', async () => {
    expect((await post('/auth/spotify/start', { clientId: 'nope' })).status).toBe(400);
    const r = await post('/auth/spotify/start', { clientId: 'a'.repeat(32) });
    expect(r.status).toBe(200);
    const { url } = await r.json() as { url: string };
    expect(url).toContain('code_challenge=');
    expect(cookieOf(r)).toMatch(/^sl_o=/);
  });
  it('callback with wrong state redirects with an error and sets no session', async () => {
    const start = await post('/auth/spotify/start', { clientId: 'a'.repeat(32) });
    const r = await SELF.fetch('http://127.0.0.1/auth/spotify/callback?code=x&state=WRONG', { headers: { cookie: cookieOf(start) }, redirect: 'manual' });
    expect(r.status).toBe(302); expect(r.headers.get('location')).toContain('spotify_error=state_mismatch');
    expect(r.headers.get('set-cookie') ?? '').not.toMatch(/sl_s=/);
  });
  it('callback happy path writes a session with counts', async () => {
    const start = await post('/auth/spotify/start', { clientId: 'a'.repeat(32) });
    const state = new URL((await start.json() as { url: string }).url).searchParams.get('state')!;
    fetchMock.get('https://accounts.spotify.com').intercept({ path: '/api/token', method: 'POST' }).reply(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600 });
    const api = fetchMock.get('https://api.spotify.com');
    api.intercept({ path: '/v1/me' }).reply(200, me);
    api.intercept({ path: '/v1/me/playlists?limit=1' }).reply(200, { total: 41, items: [], next: null });
    api.intercept({ path: '/v1/me/tracks?limit=50&offset=0' }).reply(200, { total: 3036, items: [], next: null }); // callback calls savedTracks(0) → limit=50
    const r = await SELF.fetch(`http://127.0.0.1/auth/spotify/callback?code=c&state=${state}`, { headers: { cookie: cookieOf(start) }, redirect: 'manual' });
    expect(r.headers.get('location')).toBe('/connect');
    const cookies = r.headers.get('set-cookie')!;
    const s = await SELF.fetch('http://127.0.0.1/api/session', { headers: { cookie: cookies.match(/sl_s=[^;]+/)![0] } });
    expect(await s.json()).toMatchObject({ spotify: { counts: { playlists: 41, liked: 3036 } }, destination: null });
  });
  it('job creation requires both connections and a non-empty selection', async () => {
    expect((await post('/api/jobs', { liked: true })).status).toBe(401);
  });
  it('unknown job → 404; bad id → 404', async () => {
    expect((await SELF.fetch('http://127.0.0.1/api/jobs/zzz')).status).toBe(404);
    expect((await SELF.fetch('http://127.0.0.1/api/jobs/0123456789abcdefghjkmnpqrs')).status).toBe(404);
  });
  it('security headers on every response', async () => {
    const r = await SELF.fetch('http://127.0.0.1/api/stats');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('cache-control')).toBe('public, max-age=300');
  });
});
