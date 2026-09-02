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
const pause = (ms = 3000) => new Promise(r => setTimeout(r, ms));
const blocked = (status: number, text: string) => status === 403 && text.includes('<title>Sorry');
async function post(label: string, url: string, headers: Record<string, string>, body: object, retry = true): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  if (blocked(r.status, text)) { console.log(`${label} → BLOCKED by abuse page${retry ? ', waiting 45 s and retrying once' : ''}`); if (!retry) return null; await pause(45_000); return post(label, url, headers, body, false); }
  let j: any = null; try { j = JSON.parse(text); } catch {}
  console.log(`${label} → ${r.status}, ${text.length} bytes${j?.error ? ' ❌ ' + (j.error.message ?? JSON.stringify(j.error)).slice(0, 120) : j ? ' ✅' : ' ❌ non-JSON ' + text.slice(0, 80)}`);
  return j;
}
const tv = (token: string, endpoint: string, body: object, ctx: object = TV, ua = TV_UA) => post(`TV ${endpoint}`, `https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, { 'content-type': 'application/json', 'user-agent': ua, authorization: `Bearer ${token}` }, { ...body, context: ctx });
const anon = (endpoint: string, body: object) => post(`ANON ${endpoint}`, `https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://music.youtube.com', 'x-origin': 'https://music.youtube.com' }, { ...body, context: web() });
async function dataApi(token: string, method: string, path: string, body?: object) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {}
  console.log(`DATA ${method} ${path.split('?')[0]} → ${r.status}${j?.error ? ' ❌ ' + j.error.message : ' ✅'}`);
  return j;
}

(async () => {
  const token = await getToken();
  // 1. anonymous WEB_REMIX search (matcher path); fall back to a known id if blocked
  const s = await anon('search', { query: 'Aphex Twin Xtal', params: P_SONGS }); if (s) save('anon-search-songs', s);
  const videoId = JSON.stringify(s ?? '').match(/"videoId":"([\w-]{11})"/)?.[1] ?? '2tOutF8B3f8'; console.log('  videoId', videoId);
  await pause();
  const a = await anon('search', { query: 'Aphex Twin Selected Ambient Works 85-92', params: 'EgWKAQIYAWoMEA4QChADEAQQCRAF' }); if (a) save('anon-search-albums', a);
  const albumBrowseId = JSON.stringify(a ?? '').match(/"browseId":"(MPRE[\w-]+)"/)?.[1]; console.log('  album browseId', albumBrowseId);
  await pause();
  let albumPl: string | undefined;
  if (albumBrowseId) { const b = await anon('browse', { browseId: albumBrowseId }); if (b) save('anon-browse-album', b); albumPl = String(b?.microformat?.microformatDataRenderer?.urlCanonical ?? '').match(/list=([\w-]+)/)?.[1]; console.log('  album playlistId', albumPl); await pause(); }
  const channelId = 'UCWmnkYUzoOiOztmPBhIlZjg'; // from the previous run's artist search
  // 2. playlist creation: TV variants, then WEB/ANDROID probes, then Data API fallback
  let pl: string | undefined;
  const c1 = await tv(token, 'playlist/create', { title: 'sideload spike (delete me)', privacyStatus: 'PRIVATE' }); pl = c1?.playlistId; await pause();
  if (!pl) { const c2 = await tv(token, 'playlist/create', { title: 'sideload spike (delete me)' }); pl = c2?.playlistId; await pause(); }
  if (!pl) { const c3 = await tv(token, 'playlist/create', { title: 'sideload spike (delete me)', privacyStatus: 'PRIVATE', videoIds: [videoId] }); pl = c3?.playlistId; console.log('  (TV create with videoIds)'); await pause(); }
  if (!pl) { const c4 = await post('WEB playlist/create', 'https://www.youtube.com/youtubei/v1/playlist/create?prettyPrint=false', { 'content-type': 'application/json', 'user-agent': UA, authorization: `Bearer ${token}` }, { title: 'sideload spike (delete me)', privacyStatus: 'PRIVATE', context: { client: { clientName: 'WEB', clientVersion: '2.20250120.00.00', hl: 'en', gl: 'US' }, user: {} } }); pl = c4?.playlistId; await pause(); }
  if (!pl) { const c5 = await post('ANDROID playlist/create', 'https://www.youtube.com/youtubei/v1/playlist/create?prettyPrint=false', { 'content-type': 'application/json', 'user-agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip', authorization: `Bearer ${token}` }, { title: 'sideload spike (delete me)', privacyStatus: 'PRIVATE', context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en', gl: 'US' }, user: {} } }); pl = c5?.playlistId; await pause(); }
  let plViaData = false;
  if (!pl) { const c6 = await dataApi(token, 'POST', 'playlists?part=snippet,status', { snippet: { title: 'sideload spike (delete me)' }, status: { privacyStatus: 'private' } }); pl = c6?.id; plViaData = !!pl; save('data-playlist-insert', c6); await pause(); }
  console.log('  playlistId', pl, plViaData ? '(via Data API)' : '(via InnerTube)');
  // 3. writes through TV
  if (pl) { save('tv-edit-playlist', await tv(token, 'browse/edit_playlist', { playlistId: pl, actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }] })); await pause(); }
  save('tv-like', await tv(token, 'like/like', { target: { videoId } })); await pause();
  if (albumPl) { save('tv-like-album', await tv(token, 'like/like', { target: { playlistId: albumPl } })); await pause(); }
  save('tv-subscribe', await tv(token, 'subscription/subscribe', { channelIds: [channelId] })); await pause(5000);
  // 4. read-backs
  if (pl) { const rb = await tv(token, 'browse', { browseId: `VL${pl}` }); if (rb) save('tv-browse-playlist', rb); console.log('  TV read-back has video:', JSON.stringify(rb ?? '').includes(videoId)); await pause();
    const di = await dataApi(token, 'GET', `playlistItems?part=contentDetails&maxResults=50&playlistId=${pl}`); save('data-playlistItems', di); console.log('  Data API read-back has video:', JSON.stringify(di).includes(videoId)); }
  const dr = await dataApi(token, 'GET', `videos/getRating?id=${videoId}`); console.log('  Data API rating:', dr?.items?.[0]?.rating);
  const ds = await dataApi(token, 'GET', `subscriptions?part=snippet&mine=true&forChannelId=${channelId}`); console.log('  Data API subscribed:', ds?.pageInfo?.totalResults);
  if (albumPl) { const dp = await dataApi(token, 'GET', `playlists?part=id&mine=true&maxResults=50`); console.log('  Data API my playlists include album:', JSON.stringify(dp).includes(albumPl)); }
  const ll = await tv(token, 'browse', { browseId: 'VLLL' }); if (ll) { save('tv-browse-liked', ll); console.log('  TV VLLL has video:', JSON.stringify(ll).includes(videoId)); }
  // 5. cleanup
  await pause(); await tv(token, 'like/removelike', { target: { videoId } });
  if (albumPl) { await pause(); await tv(token, 'like/removelike', { target: { playlistId: albumPl } }); }
  await pause(); await tv(token, 'subscription/unsubscribe', { channelIds: [channelId] });
  if (pl) { await pause(); const d = await tv(token, 'playlist/delete', { playlistId: pl }); if (!d || d.error) await dataApi(token, 'DELETE', `playlists?id=${pl}`); }
  console.log('\nDONE.');
})();
