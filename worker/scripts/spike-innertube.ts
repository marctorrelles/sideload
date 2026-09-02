// worker/scripts/spike-innertube.ts — run: pnpm tsx worker/scripts/spike-innertube.ts
// Proves the TV-client device flow works against InnerTube and records redacted fixtures (replaces the synthetic ones).
import { readFileSync, writeFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.dev.vars', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split('=') as [string, string]));
const SCOPE = 'https://www.googleapis.com/auth/youtube';
const BASE = 'https://music.youtube.com/youtubei/v1/';
const KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0';

async function form(url: string, data: Record<string, string>) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
  return { status: r.status, json: await r.json() as any };
}
async function it(token: string, endpoint: string, body: object) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const r = await fetch(`${BASE}${endpoint}?alt=json&key=${KEY}&prettyPrint=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://music.youtube.com', 'x-origin': 'https://music.youtube.com', authorization: `Bearer ${token}`, 'x-goog-request-time': String(Math.floor(Date.now() / 1000)) },
    body: JSON.stringify({ ...body, context: { client: { clientName: 'WEB_REMIX', clientVersion: `1.${d}.01.00`, hl: 'en', gl: 'US' }, user: {} } }),
  });
  const text = await r.text();
  console.log(endpoint, r.status, text.length, 'bytes');
  try { return JSON.parse(text); } catch { throw new Error(`non-JSON from ${endpoint}: ${text.slice(0, 200)}`); }
}
const P = { songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF', videos: 'EgWKAQIQAWoMEA4QChADEAQQCRAF', albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF', artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF' };

(async () => {
  // 1. device code
  const dc = await form('https://oauth2.googleapis.com/device/code', { client_id: env.GOOGLE_CLIENT_ID!, scope: SCOPE });
  console.log('Open', dc.json.verification_url, 'and enter', dc.json.user_code);
  let tok: any;
  for (;;) {
    await new Promise(r => setTimeout(r, (dc.json.interval ?? 5) * 1000));
    const t = await form('https://oauth2.googleapis.com/token', { client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, device_code: dc.json.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    if (t.json.access_token) { tok = t.json; break; }
    if (t.json.error !== 'authorization_pending' && t.json.error !== 'slow_down') throw new Error(JSON.stringify(t.json));
  }
  console.log('token ok, scope:', tok.scope);
  const save = (n: string, j: unknown) => writeFileSync(`worker/test/fixtures/${n}.json`, JSON.stringify(j, null, 1));
  // 2. search
  const s = await it(tok.access_token, 'search', { query: 'Aphex Twin Xtal', params: P.songs }); save('innertube-search-songs', s);
  const a = await it(tok.access_token, 'search', { query: 'Aphex Twin Selected Ambient Works 85-92', params: P.albums }); save('innertube-search-albums', a);
  const ar = await it(tok.access_token, 'search', { query: 'Aphex Twin', params: P.artists }); save('innertube-search-artists', ar);
  const videoId = JSON.stringify(s).match(/"videoId":"([\w-]{11})"/)?.[1]; console.log('first videoId', videoId);
  const albumBrowseId = JSON.stringify(a).match(/"browseId":"(MPRE[\w-]+)"/)?.[1]; console.log('album browseId', albumBrowseId);
  const channelId = JSON.stringify(ar).match(/"browseId":"(UC[\w-]{22})"/)?.[1]; console.log('artist channelId', channelId);
  // 3. album → playlist id
  const b = await it(tok.access_token, 'browse', { browseId: albumBrowseId }); save('innertube-browse-album', b);
  console.log('album playlistId', b?.microformat?.microformatDataRenderer?.urlCanonical);
  // 4. create playlist + add
  const c = await it(tok.access_token, 'playlist/create', { title: 'sideload spike (delete me)', description: '', privacyStatus: 'PRIVATE' }); save('innertube-playlist-create', c);
  const e = await it(tok.access_token, 'browse/edit_playlist', { playlistId: c.playlistId, actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' }] }); save('innertube-edit-playlist', e);
  // 5. like + subscribe
  console.log('like', (await it(tok.access_token, 'like/like', { target: { videoId } }))?.status ?? 'ok');
  console.log('subscribe', JSON.stringify(await it(tok.access_token, 'subscription/subscribe', { channelIds: [channelId] })).slice(0, 120));
  // 6. read-backs (D15): the spike playlist, liked songs, and a big playlist with a continuation
  save('innertube-browse-playlist', await it(tok.access_token, 'browse', { browseId: `VL${c.playlistId}` }));
  save('innertube-browse-liked', await it(tok.access_token, 'browse', { browseId: 'VLLM' }));
  const big = await it(tok.access_token, 'browse', { browseId: 'VLPLMyuRWv3HSaI' }); save('innertube-browse-playlist-big', big); // a 2,500+ track playlist → forces a continuation
  const token = JSON.stringify(big).match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1]; console.log('continuation token', token?.slice(0, 20));
  if (token) save('innertube-browse-continuation', await it(tok.access_token, 'browse', { continuation: token }));
  console.log('DONE. Delete the spike playlist and unsubscribe by hand, then redact the fixtures (see worker/CLAUDE.md).');
})();
