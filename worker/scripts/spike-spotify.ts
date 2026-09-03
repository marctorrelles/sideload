// worker/scripts/spike-spotify.ts: run from the repo root: pnpm spike:spotify
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
  const q = new URL(req.url!, 'http://x').searchParams;
  if (q.get('error') || !q.get('code') || q.get('state') !== 'spike') { console.error('authorize returned:', Object.fromEntries(q)); process.exit(1); }
  const tr = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier }) });
  const tok = await tr.json() as any;
  if (!tr.ok || !tok.access_token) { console.error('token exchange failed:', tr.status, JSON.stringify(tok)); process.exit(1); }
  console.log('token ok, scope:', tok.scope);
  const get = async (p: string) => {
    const r = await fetch(`https://api.spotify.com/v1${p}`, { headers: { authorization: `Bearer ${tok.access_token}` } });
    const j: any = await r.json();
    console.log(p, r.status, r.headers.get('retry-after') ?? '');
    if (!r.ok) { console.error('  body:', JSON.stringify(j).slice(0, 300)); if (r.status === 403) { console.error('  → not available with this app/account; note it in docs/design/handoff.md and keep the synthetic fixture'); return null; } process.exit(1); }
    return j;
  };
  // Redaction: identity fields → REDACTED; the user's own id → "me"; every other owner id → owner_<n> (keeps ownedByUser/isAlgorithmic logic testable, 'spotify' stays).
  const me = await get('/me');
  const owners = new Map<string, string>([[me.id, 'me'], ['spotify', 'spotify']]);
  const ownerId = (id: string) => { if (!owners.has(id)) owners.set(id, `owner_${owners.size - 1}`); return owners.get(id)!; };
  const redact = (o: any, key = ''): any => Array.isArray(o) ? o.map(x => redact(x)) : o && typeof o === 'object'
    ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, (['email', 'display_name', 'country', 'uri', 'href', 'snapshot_id'].includes(k) || k === 'external_urls') && v ? (k === 'external_urls' ? { spotify: 'REDACTED' } : 'REDACTED') : k === 'id' && typeof v === 'string' && owners.has(v) ? owners.get(v) : k === 'owner' && v && typeof v === 'object' ? { ...redact(v), id: ownerId((v as any).id) } : k === 'added_by' && v ? { id: 'REDACTED' } : redact(v, k)]))
    : typeof o === 'string' && o.includes(me.id) ? o.replaceAll(me.id, 'me') : o;
  const save = (n: string, j: unknown) => j && writeFileSync(`worker/test/fixtures/${n}.json`, JSON.stringify({ _recorded: `${new Date().toISOString().slice(0, 10)} with worker/scripts/spike-spotify.ts; identity fields redacted, owner ids replaced`, ...redact(j) }, null, 1));
  save('spotify-me', { ...me, id: me.id, images: [] });
  const pl = await get('/me/playlists?limit=50'); save('spotify-me-playlists', pl);
  console.log('first playlist keys:', Object.keys(pl.items[0]), 'items.total =', pl.items[0].items?.total, 'tracks =', pl.items[0].tracks);
  const own = pl.items.find((x: any) => x.owner?.id === me.id && (x.items?.total ?? x.tracks?.total ?? 0) > 10) ?? pl.items.find((x: any) => x.owner?.id === me.id) ?? pl.items[0];
  const other = pl.items.find((x: any) => x.owner?.id !== me.id && x.owner?.id !== 'spotify');
  if (other) { console.log('probing a followed playlist owned by someone else (expected 403 in Development Mode):'); await get(`/playlists/${other.id}/items?limit=1`); }
  save('spotify-playlist-items', await get(`/playlists/${own.id}/items?limit=50&additional_types=track,episode`));
  save('spotify-me-tracks', await get('/me/tracks?limit=50'));
  save('spotify-me-albums', await get('/me/albums?limit=50'));
  save('spotify-me-following', await get('/me/following?type=artist&limit=50'));
  console.log('DONE. Fixtures rewritten; run pnpm --filter worker test, then: cd worker/test/fixtures && grep -l "@gmail" *.json || echo clean');
  process.exit(0);
}).listen(8787, '127.0.0.1');
