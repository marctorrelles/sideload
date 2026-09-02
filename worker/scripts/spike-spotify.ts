// worker/scripts/spike-spotify.ts — run: SPOTIFY_CLIENT_ID=... pnpm tsx worker/scripts/spike-spotify.ts
// Proves PKCE with a BYO client id and records redacted fixtures (replaces the synthetic ones).
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
const clientId = process.env.SPOTIFY_CLIENT_ID!;
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
  const save = (n: string, j: unknown) => writeFileSync(`worker/test/fixtures/${n}.json`, JSON.stringify(j, null, 1));
  save('spotify-me', await get('/me'));
  const pl = await get('/me/playlists?limit=50'); save('spotify-me-playlists', pl);
  console.log('first playlist keys:', Object.keys(pl.items[0]), 'items.total =', pl.items[0].items?.total, 'tracks =', pl.items[0].tracks);
  save('spotify-playlist-items', await get(`/playlists/${pl.items[0].id}/items?limit=50&additional_types=track,episode`));
  save('spotify-me-tracks', await get('/me/tracks?limit=50'));
  save('spotify-me-albums', await get('/me/albums?limit=50'));
  save('spotify-me-following', await get('/me/following?type=artist&limit=50'));
  process.exit(0);
}).listen(8787, '127.0.0.1');
