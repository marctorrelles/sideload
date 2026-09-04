// worker/src/index.ts: Hono app: API + auth routes, then static assets.
import { Hono } from 'hono';
import * as Sentry from '@sentry/cloudflare';
import { sentryOptions } from './sentry';
import { track } from './telemetry';
import type { Env } from './env';
import { HttpError, securityHeaders, withSecurityHeaders, sameOrigin, rateLimit } from './http';
import { readSession, writeSession, clearSession, readTransient, writeTransient, clearTransient, type Session } from './cookie';
import { authorizeUrl, exchangeCode, Spotify, SpotifyError, CLIENT_ID_RE } from './spotify';
import { demoTokens, DEMO_USER, DEMO_COUNTS } from './spotify-demo';
import { deviceCode, pollDevice, channelInfo } from './google';
import { randomId, ID_RE, pkceVerifier, pkceChallenge } from './crypto';
import { validateSelection } from './routes-validate';
import type { SessionView, Library, ReviewAction } from '@shared/types';
import { JobDO as JobDOBase } from './job-do';
import { StatsDO as StatsDOBase } from './stats-do';
// The wrapped classes are what wrangler binds (same export names); alarms and RPC calls run inside a Sentry scope.
export const JobDO = Sentry.instrumentDurableObjectWithSentry(sentryOptions, JobDOBase);
export const StatsDO = Sentry.instrumentDurableObjectWithSentry(sentryOptions, StatsDOBase);

type App = { Bindings: Env };
const app = new Hono<App>();
app.use('*', securityHeaders);
app.use('/api/*', sameOrigin);
app.use('/auth/*', sameOrigin);
app.onError((e, c) => {
  if (e instanceof HttpError) return withSecurityHeaders(c.json({ error: e.code, message: e.message }, e.status), c.req.path);
  if (e instanceof SpotifyError) { // Spotify's own words reach the user; the endpoint reaches the log
    const premium = /premium/i.test(e.message);
    console.error(JSON.stringify({ evt: 'spotify_error', path: c.req.path, status: e.status, err: e.message.slice(0, 300) }));
    const message = premium ? 'Spotify requires the owner of a Development Mode app to have an active Premium subscription. Just subscribed? Spotify can take a few hours to notice. Try again later.'
      : e.status === 401 ? 'Your Spotify sign-in expired. Connect it again.' : `Spotify answered ${e.status} on ${e.message.split(':')[0]}. Try again in a minute.`;
    return withSecurityHeaders(c.json({ error: premium ? 'spotify_premium_required' : `spotify_${e.code}`, message }, e.status === 401 ? 401 : e.status === 403 ? 403 : 502), c.req.path);
  }
  Sentry.captureException(e);
  console.error(JSON.stringify({ evt: 'unhandled', path: c.req.path, err: String(e).slice(0, 300) }));
  return withSecurityHeaders(c.json({ error: 'internal', message: 'Something broke on our side. Try again in a minute.' }, 500), c.req.path);
});
const redirectUri = (env: Env) => `${env.PUBLIC_ORIGIN}/auth/spotify/callback`;
const sessionView = (s: Session | null): SessionView => ({
  spotify: s?.spotify ? { displayName: s.spotify.displayName, email: s.spotify.email, clientId: s.spotify.clientId, counts: s.spotify.counts } : null,
  destination: s?.google ? { provider: 'ytmusic', account: s.google.account ?? null } : null,
});
const jobStub = (c: { env: Env }, id: string) => { if (!ID_RE.test(id)) throw new HttpError(404, 'not_found'); return c.env.JOB.get(c.env.JOB.idFromName(id)); };

// ---- session
app.get('/api/session', rateLimit('RL_READ'), async c => c.json(sessionView(await readSession(c, c.env))));

// ---- Spotify (BYO client id + PKCE)
app.post('/auth/spotify/start', rateLimit('RL_AUTH'), async c => {
  const body = await c.req.json().catch(() => ({})) as { clientId?: unknown };
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim().toLowerCase() : '';
  if (!CLIENT_ID_RE.test(clientId)) throw new HttpError(400, 'bad_client_id', 'A Spotify Client ID is 32 hex characters. Copy it from your app in the Spotify dashboard.');
  if (c.env.REVIEW_CODE && clientId === c.env.REVIEW_CODE) { // the built-in demo library: no Spotify round trip, straight to "connected"
    const s = await readSession(c, c.env) ?? {};
    await writeSession(c, c.env, { ...s, tid: s.tid ?? randomId(), spotify: { ...demoTokens(clientId), userId: DEMO_USER.id, email: null, displayName: DEMO_USER.display_name, counts: DEMO_COUNTS } });
    return c.json({ url: '/connect?connected=spotify' });
  }
  const state = randomId(), verifier = pkceVerifier();
  await writeTransient(c, c.env, { ...(await readTransient(c, c.env) ?? {}), spotify: { state, verifier, clientId } });
  return c.json({ url: authorizeUrl({ clientId, redirectUri: redirectUri(c.env), state, challenge: await pkceChallenge(verifier) }) });
});
app.get('/auth/spotify/callback', async c => {
  const t = (await readTransient(c, c.env))?.spotify;
  const q = c.req.query();
  const back = (err: string) => c.redirect(`/connect?spotify_error=${encodeURIComponent(err)}`);
  if (!t || !q.state || q.state !== t.state) return back('state_mismatch');
  if (q.error || !q.code) return back(q.error ?? 'no_code');
  try {
    const tok = await exchangeCode({ clientId: t.clientId, code: q.code, verifier: t.verifier, redirectUri: redirectUri(c.env) });
    const tokens = { access: tok.access_token, refresh: tok.refresh_token!, expiresAt: Date.now() + tok.expires_in * 1000, clientId: t.clientId };
    const sp = new Spotify(tokens, async () => {});
    const [me, pl, liked] = await Promise.all([sp.me(), sp.playlists('/me/playlists?limit=1'), sp.savedTracks(0).catch(() => ({ total: 0 }))]);
    const s = await readSession(c, c.env) ?? {};
    const tid = s.tid ?? randomId();
    await writeSession(c, c.env, { ...s, tid, spotify: { ...tokens, userId: me.id, email: me.email ?? null, displayName: me.display_name ?? me.id, counts: { playlists: pl.total, liked: liked.total } } });
    c.executionCtx.waitUntil(track(c.env, 'spotify_connected', tid, { playlists: pl.total, liked: liked.total }));
    clearTransient(c);
    return c.redirect('/connect?connected=spotify'); // the island lights the card once, then strips the query
  } catch (e) {
    if (e instanceof SpotifyError) console.error(JSON.stringify({ evt: 'spotify_error', path: c.req.path, status: e.status, err: e.message.slice(0, 300) }));
    return back(e instanceof SpotifyError ? (/premium/i.test(e.message) ? 'premium_required' : e.code) : 'token_exchange_failed');
  }
});
app.post('/auth/spotify/logout', async c => { const s = await readSession(c, c.env) ?? {}; delete s.spotify; await writeSession(c, c.env, s); return c.json({ ok: true }); });

// ---- Google (device code)
app.post('/auth/google/start', rateLimit('RL_AUTH'), async c => {
  const d = await deviceCode(c.env.GOOGLE_CLIENT_ID);
  await writeTransient(c, c.env, { ...(await readTransient(c, c.env) ?? {}), google: { deviceCode: d.deviceCode, expiresAt: Date.now() + d.expiresIn * 1000 } });
  return c.json({ userCode: d.userCode, verificationUrl: d.verificationUrl, interval: d.interval, expiresIn: d.expiresIn });
});
app.post('/auth/google/poll', rateLimit('RL_READ'), async c => {
  const tr = await readTransient(c, c.env);
  const g = tr?.google;
  if (!tr || !g || g.expiresAt < Date.now()) return c.json({ status: 'expired' });
  const r = await pollDevice(c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, g.deviceCode);
  if (r.status !== 'ok') return c.json({ status: r.status });
  const s = await readSession(c, c.env) ?? {};
  await writeSession(c, c.env, { ...s, google: { access: r.access, refresh: r.refresh, expiresAt: r.expiresAt, account: await channelInfo(r.access) } });
  c.executionCtx.waitUntil(track(c.env, 'youtube_connected', s.tid));
  delete tr.google; await writeTransient(c, c.env, tr);
  return c.json({ status: 'connected' });
});
app.post('/auth/google/logout', async c => { const s = await readSession(c, c.env) ?? {}; delete s.google; await writeSession(c, c.env, s); return c.json({ ok: true }); });

// ---- library
app.get('/api/library', rateLimit('RL_READ'), async c => {
  const s = await readSession(c, c.env);
  if (!s?.spotify) throw new HttpError(401, 'spotify_required');
  const sp = new Spotify(s.spotify, async t => { await writeSession(c, c.env, { ...s, spotify: { ...s.spotify!, ...t } }); });
  const playlists: Library['playlists'] = [];
  for (let url: string | null = '/me/playlists?limit=50'; url; ) {
    const p = await sp.playlists(url);
    for (const x of p.items) playlists.push({ id: x.id, name: x.name, description: x.description, owner: x.owner.display_name ?? x.owner.id, ownedByUser: x.owner.id === s.spotify.userId, isAlgorithmic: x.owner.id === 'spotify', collaborative: x.collaborative, isPublic: x.public, trackCount: x.items?.total ?? x.tracks?.total ?? null, image: x.images?.[0]?.url ?? null });
    url = p.next;
  }
  const albums: Library['albums'] = [];
  for (let url: string | null = '/me/albums?limit=50'; url; ) { const p = await sp.savedAlbums(url); for (const { album } of p.items) albums.push({ id: album.id, name: album.name, artist: album.artists.map(a => a.name).join(', '), trackCount: album.total_tracks, image: album.images?.[0]?.url ?? null }); url = p.next; }
  const artists: Library['artists'] = [];
  for (let after: string | undefined; ; ) { const p = await sp.followedArtists(after); for (const a of p.artists.items) artists.push({ id: a.id, name: a.name, image: a.images?.[0]?.url ?? null }); if (!p.artists.cursors.after || !p.artists.items.length) break; after = p.artists.cursors.after; }
  const lib: Library = { likedCount: s.spotify.counts.liked, playlists, albums, artists };
  c.executionCtx.waitUntil(track(c.env, 'library_loaded', s.tid, { playlists: playlists.length, locked: playlists.filter(p => !p.ownedByUser).length, albums: albums.length, artists: artists.length, liked: lib.likedCount }));
  return c.json(lib);
});

// ---- jobs
app.post('/api/jobs', rateLimit('RL_JOB_CREATE'), async c => {
  const s = await readSession(c, c.env);
  if (!s?.spotify || !s.google) throw new HttpError(401, 'both_required', 'Connect Spotify and YouTube Music first.');
  const selection = validateSelection(await c.req.json().catch(() => null));
  const id = randomId();
  const r = await c.env.JOB.get(c.env.JOB.idFromName(id)).start({ id, tid: s.tid, spotify: { clientId: s.spotify.clientId, access: s.spotify.access, refresh: s.spotify.refresh, expiresAt: s.spotify.expiresAt }, google: s.google, selection });
  if (!r.ok) throw r.error === 'too_large' ? new HttpError(413, 'too_large', 'That is more than 25,000 songs. Split it into two transfers.') : new HttpError(409, r.error);
  clearSession(c);
  console.log(JSON.stringify({ evt: 'job_created', job: id.slice(0, 6), playlists: selection.playlists.length, liked: selection.liked, albums: selection.albums.length, artists: selection.artists.length }));
  c.executionCtx.waitUntil(track(c.env, 'job_created', s.tid, { job: id.slice(0, 6), playlists: selection.playlists.length, liked: selection.liked, albums: selection.albums.length, artists: selection.artists.length }));
  return c.json({ id });
});
app.get('/api/jobs/:id', rateLimit('RL_READ'), async c => { const v = await jobStub(c, c.req.param('id')).view(); if (!v) throw new HttpError(404, 'not_found'); return c.json(v); });
app.get('/api/jobs/:id/review', rateLimit('RL_READ'), async c => c.json(await jobStub(c, c.req.param('id')).review(Number(c.req.query('offset') ?? 0))));
app.post('/api/jobs/:id/pause', rateLimit('RL_READ'), async c => { await jobStub(c, c.req.param('id')).pause(); return c.json({ ok: true }); });
app.post('/api/jobs/:id/resume', rateLimit('RL_READ'), async c => { await jobStub(c, c.req.param('id')).resume(); return c.json({ ok: true }); });
app.post('/api/jobs/:id/disconnect', rateLimit('RL_READ'), async c => { await jobStub(c, c.req.param('id')).disconnect(); return c.json({ ok: true }); });
app.post('/api/jobs/:id/review/:trackId', rateLimit('RL_READ'), async c => {
  const body = await c.req.json().catch(() => null) as ReviewAction | null;
  if (!body || !['closest', 'manual', 'skip'].includes(body.action)) throw new HttpError(400, 'bad_action');
  const trackId = Number(c.req.param('trackId'));
  if (!Number.isInteger(trackId) || trackId < 1) throw new HttpError(400, 'bad_track');
  const r = await jobStub(c, c.req.param('id')).resolve(trackId, body);
  if (!r.ok) throw new HttpError(r.error === 'disconnected' ? 409 : 400, r.error);
  return c.json({ ok: true });
});
app.get('/api/jobs/:id/search', rateLimit('RL_SEARCH', c => c.req.param('id') ?? ''), async c => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) throw new HttpError(400, 'bad_query');
  const r = await jobStub(c, c.req.param('id')).search(q);
  if (!r) throw new HttpError(409, 'disconnected', 'The YouTube Music connection was dropped. Start another transfer to search again.');
  return c.json(r);
});
app.get('/api/jobs/:id/report.csv', rateLimit('RL_READ'), async c => {
  const stub = jobStub(c, c.req.param('id'));
  if (!(await stub.view())) throw new HttpError(404, 'not_found');
  return new Response(await stub.reportCsv(), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="sideload-report-${c.req.param('id').slice(0, 8)}.csv"`, 'cache-control': 'no-store' } });
});
app.get('/api/stats', async c => { c.header('Cache-Control', 'public, max-age=300'); return c.json(await c.env.STATS.get(c.env.STATS.idFromName('global')).get()); });

// ---- app shell for /t/:id (static assets do not know the id)
app.get('/t/:id', async c => {
  if (!ID_RE.test(c.req.param('id'))) { const nf = await c.env.ASSETS.fetch(new Request(new URL('/404', c.req.url))); return new Response(nf.body, { status: 404, headers: nf.headers }); }
  const res = await c.env.ASSETS.fetch(new Request(new URL('/t/', c.req.url)));
  const out = new Response(res.body, res); out.headers.set('X-Robots-Tag', 'noindex'); return out;
});
app.all('*', c => c.env.ASSETS.fetch(c.req.raw));
export default Sentry.withSentry<Env>(sentryOptions, { fetch: (req, env, ctx) => app.fetch(req, env, ctx) });
