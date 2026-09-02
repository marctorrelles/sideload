// worker/scripts/spike-yt-debug.ts — run: pnpm tsx worker/scripts/spike-yt-debug.ts
// Diagnoses the 400s: caches the OAuth token in .yt_token.json (gitignored) so we don't re-auth every run,
// then fires one `search` under several request-shape variants and prints the FULL body of each.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.dev.vars', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.split('=') as [string, string]));
const SCOPE = 'https://www.googleapis.com/auth/youtube';
const KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const TOKFILE = '.yt_token.json';

async function form(url: string, data: Record<string, string>) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
  return { status: r.status, json: await r.json() as any };
}
async function getToken(): Promise<string> {
  if (existsSync(TOKFILE)) {
    const t = JSON.parse(readFileSync(TOKFILE, 'utf8'));
    if (t.expiresAt > Date.now() + 60_000) { console.log('reusing cached token'); return t.access; }
    // refresh
    const r = await form('https://oauth2.googleapis.com/token', { client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: t.refresh, grant_type: 'refresh_token' });
    if (r.json.access_token) { const n = { access: r.json.access_token, refresh: t.refresh, expiresAt: Date.now() + r.json.expires_in * 1000 }; writeFileSync(TOKFILE, JSON.stringify(n)); console.log('refreshed token'); return n.access; }
  }
  const dc = await form('https://oauth2.googleapis.com/device/code', { client_id: env.GOOGLE_CLIENT_ID!, scope: SCOPE });
  console.log('Open', dc.json.verification_url, 'and enter', dc.json.user_code);
  for (;;) {
    await new Promise(r => setTimeout(r, (dc.json.interval ?? 5) * 1000));
    const t = await form('https://oauth2.googleapis.com/token', { client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, device_code: dc.json.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    if (t.json.access_token) { const n = { access: t.json.access_token, refresh: t.json.refresh_token, expiresAt: Date.now() + t.json.expires_in * 1000 }; writeFileSync(TOKFILE, JSON.stringify(n)); return n.access; }
    if (t.json.error !== 'authorization_pending' && t.json.error !== 'slow_down') throw new Error(JSON.stringify(t.json));
  }
}

const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0';
const P_SONGS = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';
const H = (token: string, extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', 'user-agent': UA, origin: 'https://music.youtube.com', 'x-origin': 'https://music.youtube.com', authorization: `Bearer ${token}`, ...extra });
const web = (extra: object = {}) => ({ client: { clientName: 'WEB_REMIX', clientVersion: `1.${d}.01.00`, hl: 'en', gl: 'US', ...extra }, user: {} });

async function visitorData(): Promise<string | null> {
  const html = await (await fetch('https://music.youtube.com', { headers: { 'user-agent': UA, 'accept-language': 'en' } })).text();
  return html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1] ?? html.match(/visitorData":"([^"]+)"/)?.[1] ?? null;
}

const TV = { client: { clientName: 'TVHTML5', clientVersion: '7.20250120.19.00', hl: 'en', gl: 'US' }, user: {} };
const TV_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/2.2 Chrome/63.0.3239.84 TV Safari/537.36';
const save = (n: string, j: unknown) => writeFileSync(`worker/test/fixtures/${n}.raw.json`, JSON.stringify(j, null, 1));
async function tv(token: string, endpoint: string, body: object) {
  const r = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': TV_UA, authorization: `Bearer ${token}` }, body: JSON.stringify({ ...body, context: TV }) });
  const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
  console.log(`TV ${endpoint} → ${r.status}, ${text.length} bytes${j?.error ? ' ❌ ' + JSON.stringify(j.error).slice(0, 160) : ' ✅'}`);
  return j ?? text;
}
async function anon(endpoint: string, body: object) {
  const r = await fetch(`https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://music.youtube.com', 'x-origin': 'https://music.youtube.com' }, body: JSON.stringify({ ...body, context: web() }) });
  const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
  console.log(`ANON ${endpoint} → ${r.status}, ${text.length} bytes${j ? ' ✅' : ' ❌ ' + text.slice(0, 120)}`);
  return j ?? text;
}
async function dataApi(token: string, path: string) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { headers: { authorization: `Bearer ${token}` } });
  const j: any = await r.json();
  console.log(`DATA ${path.split('?')[0]} → ${r.status}${j.error ? ' ❌ ' + j.error.message : ' ✅'}`);
  return j;
}
const pause = (ms = 1500) => new Promise(r => setTimeout(r, ms));

(async () => {
  const token = await getToken();
  // --- anonymous WEB_REMIX: the matcher's search path
  const s = await anon('search', { query: 'Aphex Twin Xtal', params: P_SONGS }); save('anon-search-songs', s);
  const videoId = JSON.stringify(s).match(/"videoId":"([\w-]{11})"/)?.[1]!; console.log('  song videoId', videoId);
  await pause();
  const a = await anon('search', { query: 'Aphex Twin Selected Ambient Works 85-92', params: 'EgWKAQIYAWoMEA4QChADEAQQCRAF' }); save('anon-search-albums', a);
  const albumBrowseId = JSON.stringify(a).match(/"browseId":"(MPRE[\w-]+)"/)?.[1]; console.log('  album browseId', albumBrowseId);
  await pause();
  const ar = await anon('search', { query: 'Aphex Twin', params: 'EgWKAQIgAWoMEA4QChADEAQQCRAF' }); save('anon-search-artists', ar);
  const channelId = JSON.stringify(ar).match(/"browseId":"(UC[\w-]{22})"/)?.[1]; console.log('  artist channelId', channelId);
  await pause();
  const b = await anon('browse', { browseId: albumBrowseId }); save('anon-browse-album', b);
  const albumPl = String(b?.microformat?.microformatDataRenderer?.urlCanonical ?? '').match(/list=([\w-]+)/)?.[1]; console.log('  album playlistId', albumPl);
  await pause();
  // --- TVHTML5 + OAuth: writes
  const c = await tv(token, 'playlist/create', { title: 'sideload spike (delete me)', privacyStatus: 'PRIVATE' }); save('tv-playlist-create', c);
  const pl = c?.playlistId; console.log('  created playlistId', pl);
  await pause();
  save('tv-edit-playlist', await tv(token, 'browse/edit_playlist', { playlistId: pl, actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }] }));
  await pause();
  save('tv-like', await tv(token, 'like/like', { target: { videoId } }));
  await pause();
  if (albumPl) { save('tv-like-album', await tv(token, 'like/like', { target: { playlistId: albumPl } })); await pause(); }
  if (channelId) { save('tv-subscribe', await tv(token, 'subscription/subscribe', { channelIds: [channelId] })); await pause(); }
  // --- read-backs: TV browse vs Data API
  const rb = await tv(token, 'browse', { browseId: `VL${pl}` }); save('tv-browse-playlist', rb);
  console.log('  TV read-back contains added video:', JSON.stringify(rb).includes(videoId));
  await pause();
  const ll = await tv(token, 'browse', { browseId: 'VLLL' }); save('tv-browse-liked', ll);
  console.log('  TV liked-videos read-back contains video:', JSON.stringify(ll).includes(videoId), '| has continuation token:', /"token":"/.test(JSON.stringify(ll)));
  await pause();
  const big = await tv(token, 'browse', { browseId: 'VLPLMyuRWv3HSaI' }); save('tv-browse-playlist-big', big);
  const ids = new Set([...JSON.stringify(big).matchAll(/"videoId":"([\w-]{11})"/g)].map(m => m[1])); console.log('  TV big playlist page videoIds:', ids.size, '| continuation:', JSON.stringify(big).match(/"continuation":"([^"]{10})/)?.[1] ?? JSON.stringify(big).match(/"token":"([^"]{10})/)?.[1] ?? 'none');
  await pause();
  const di = await dataApi(token, `playlistItems?part=contentDetails&maxResults=50&playlistId=${pl}`); save('data-playlistItems', di);
  console.log('  Data API read-back contains added video:', JSON.stringify(di).includes(videoId));
  const dr = await dataApi(token, `videos/getRating?id=${videoId}`); save('data-getRating', dr);
  console.log('  Data API rating:', dr?.items?.[0]?.rating);
  const dl = await dataApi(token, `playlistItems?part=contentDetails&maxResults=50&playlistId=LL`); save('data-liked-LL', dl);
  console.log('  Data API LL total:', dl?.pageInfo?.totalResults, '| contains video:', JSON.stringify(dl).includes(videoId));
  const ds = await dataApi(token, `subscriptions?part=snippet&mine=true&forChannelId=${channelId}`); save('data-subscriptions', ds);
  console.log('  Data API subscribed:', ds?.pageInfo?.totalResults);
  // --- cleanup
  await pause();
  await tv(token, 'like/removelike', { target: { videoId } });
  if (albumPl) { await pause(); await tv(token, 'like/removelike', { target: { playlistId: albumPl } }); }
  if (channelId) { await pause(); await tv(token, 'subscription/unsubscribe', { channelIds: [channelId] }); }
  await pause(); await tv(token, 'playlist/delete', { playlistId: pl });
  console.log('\nDONE. Raw responses in worker/test/fixtures/*.raw.json (gitignored).');
})();
