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

(async () => {
  const token = await getToken();
  // 0. Is the token alive at all? (official Data API, 1 quota unit)
  { const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers: { authorization: `Bearer ${token}` } });
    console.log(`\n=== 0 Data API v3 channels.mine → ${r.status}: ${(await r.text()).slice(0, 200).replace(/\s+/g, ' ')}`); }
  const vd = await visitorData(); console.log('visitorData:', vd ? vd.slice(0, 16) + '…' : 'NOT FOUND');
  const M = 'https://music.youtube.com/youtubei/v1/';
  const variants: { name: string; url: string; headers: Record<string, string>; body: object }[] = [
    { name: '1 WEB_REMIX search, no params', url: `${M}search?prettyPrint=false`, headers: H(token), body: { query: 'Aphex Twin Xtal', context: web() } },
    { name: '2 WEB_REMIX browse FEmusic_home (no query)', url: `${M}browse?prettyPrint=false`, headers: H(token), body: { browseId: 'FEmusic_home', context: web() } },
    { name: '3 WEB_REMIX + visitorData in context + X-Goog-Visitor-Id', url: `${M}search?prettyPrint=false`, headers: H(token, vd ? { 'x-goog-visitor-id': vd } : {}), body: { query: 'Aphex Twin Xtal', params: P_SONGS, context: web(vd ? { visitorData: vd } : {}) } },
    { name: '4 WEB_REMIX older clientVersion 1.20250101', url: `${M}search?prettyPrint=false`, headers: H(token), body: { query: 'Aphex Twin Xtal', params: P_SONGS, context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'US' }, user: {} } } },
    { name: '5 WEB_REMIX + X-Goog-AuthUser + X-Goog-Request-Time', url: `${M}search?prettyPrint=false`, headers: H(token, { 'x-goog-authuser': '0', 'x-goog-request-time': String(Math.floor(Date.now() / 1000)) }), body: { query: 'Aphex Twin Xtal', params: P_SONGS, context: web() } },
    { name: '6 TVHTML5 context on www.youtube.com', url: `https://www.youtube.com/youtubei/v1/search?prettyPrint=false`, headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/2.2 Chrome/63.0.3239.84 TV Safari/537.36', authorization: `Bearer ${token}` }, body: { query: 'Aphex Twin Xtal', context: { client: { clientName: 'TVHTML5', clientVersion: '7.20250120.19.00', hl: 'en', gl: 'US' }, user: {} } } },
    { name: '7 ANDROID_MUSIC context', url: `${M}search?prettyPrint=false`, headers: { 'content-type': 'application/json', 'user-agent': 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 11) gzip', authorization: `Bearer ${token}`, 'x-goog-api-format-version': '2' }, body: { query: 'Aphex Twin Xtal', params: P_SONGS, context: { client: { clientName: 'ANDROID_MUSIC', clientVersion: '7.27.52', androidSdkVersion: 30, hl: 'en', gl: 'US' }, user: {} } } },
    { name: '8 WEB_REMIX anonymous (no auth header) — control', url: `${M}search?prettyPrint=false`, headers: { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://music.youtube.com', 'x-origin': 'https://music.youtube.com' }, body: { query: 'Aphex Twin Xtal', params: P_SONGS, context: web() } },
  ];
  for (const v of variants) {
    try {
      const r = await fetch(v.url, { method: 'POST', headers: v.headers, body: JSON.stringify(v.body) });
      const text = await r.text();
      const ok = r.status === 200 && text.trimStart().startsWith('{') && !text.includes('"error"');
      console.log(`\n=== ${v.name}\n  status ${r.status}, ${text.length} bytes ${ok ? '✅ OK' : '❌'}`);
      if (!ok) console.log('  body:', text.slice(0, 300).replace(/\s+/g, ' '));
      else console.log('  first videoId:', text.match(/"videoId":"([\w-]{11})"/)?.[1]);
    } catch (e) { console.log(`\n=== ${v.name}\n  threw ${String(e).slice(0, 200)}`); }
    await new Promise(r => setTimeout(r, 2000));
  }
})();
