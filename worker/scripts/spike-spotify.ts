// worker/scripts/spike-spotify.ts — run from the repo root: pnpm spike:spotify
// Reads SPOTIFY_CLIENT_ID from the environment or from .dev.vars. The Spotify app needs the redirect URI
// http://127.0.0.1:8787/auth/spotify/callback (Spotify rejects `localhost`). Records redacted fixtures (replaces the synthetic ones).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
const devVars = existsSync('.dev.vars') ? Object.fromEntries(readFileSync('.dev.vars', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split('=') as [string, string])) : {};
const clientId = (process.env.SPOTIFY_CLIENT_ID ?? devVars.SPOTIFY_CLIENT_ID ?? '').trim();
if (!/^[a-f0-9]{32}$/.test(clientId)) { console.error('Set SPOTIFY_CLIENT_ID (32 hex chars) in .dev.vars or the environment. Create the app at https://developer.spotify.com/dashboard with redirect URI http://127.0.0.1:8787/auth/spotify/callback'); process.exit(1); }
const redirect = 'http://127.0.0.1:8787/auth/spotify/callback';
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const scope = 'user-library-read playlist-read-private playlist-read-collaborative user-follow-read user-read-email';
const url = `https://accounts.spotify.com/authorize?${new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirect, scope, code_challenge_method: 'S256', code_challenge: challenge, state: 'spike' })}`;
console.log('Open:', url);
createServer(async (req, res) => {
  const code = new URL(req.url!, 'http://x').searchParams.get('code')!;
  res.end('ok, back to terminal');
  const tok = await (await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier }) })).json() as any;
  const get = async (p: string) => { const r = await fetch(`https://api.spotify.com/v1${p}`, { headers: { authorization: `Bearer ${tok.access_token}` } }); console.log(p, r.status, r.headers.get('retry-after') ?? ''); return r.json(); };
  const redact = (o: any): any => Array.isArray(o) ? o.map(redact) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, ['email', 'display_name', 'country', 'uri', 'href'].includes(k) && typeof v === 'string' ? 'REDACTED' : redact(v)])) : o;
  const save = (n: string, j: unknown) => writeFileSync(`worker/test/fixtures/${n}.json`, JSON.stringify({ _recorded: `${new Date().toISOString().slice(0, 10)} with worker/scripts/spike-spotify.ts; email/display_name/country/uri/href redacted`, ...redact(j) }, null, 1));
  const me = await get('/me'); save('spotify-me', { ...me, id: 'REDACTED' });
  const pl = await get('/me/playlists?limit=50'); save('spotify-me-playlists', pl);
  console.log('first playlist keys:', Object.keys(pl.items[0]), 'items.total =', pl.items[0].items?.total, 'tracks =', pl.items[0].tracks);
  save('spotify-playlist-items', await get(`/playlists/${pl.items[0].id}/items?limit=50&additional_types=track,episode`));
  save('spotify-me-tracks', await get('/me/tracks?limit=50'));
  save('spotify-me-albums', await get('/me/albums?limit=50'));
  save('spotify-me-following', await get('/me/following?type=artist&limit=50'));
  console.log('DONE — fixtures rewritten; run pnpm --filter worker test, then: cd worker/test/fixtures && grep -l "@gmail" *.json || echo clean');
  process.exit(0);
}).listen(8787, '127.0.0.1');
