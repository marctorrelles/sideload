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
const CTX = { client: { clientName: 'WEB_REMIX', clientVersion: `1.${d}.01.00`, hl: 'en', gl: 'US' }, user: {} };
const body = JSON.stringify({ query: 'Aphex Twin Xtal', params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF', context: CTX });

(async () => {
  const token = await getToken();
  const variants: { name: string; url: string; headers: Record<string, string> }[] = [
    { name: 'A baseline (key + origin + x-goog-request-time)', url: `https://music.youtube.com/youtubei/v1/search?alt=json&key=${KEY}&prettyPrint=false`,
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0', origin: 'https://music.youtube.com', 'x-origin': 'https://music.youtube.com', authorization: `Bearer ${token}`, 'x-goog-request-time': String(Math.floor(Date.now() / 1000)) } },
    { name: 'B no key param', url: `https://music.youtube.com/youtubei/v1/search?alt=json&prettyPrint=false`,
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0', origin: 'https://music.youtube.com', 'x-origin': 'https://music.youtube.com', authorization: `Bearer ${token}` } },
    { name: 'C minimal oauth headers (key, no origin/x-goog)', url: `https://music.youtube.com/youtubei/v1/search?alt=json&key=${KEY}&prettyPrint=false`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, accept: '*/*', 'user-agent': 'Mozilla/5.0' } },
    { name: 'D X-Goog-Api-Format-Version 2', url: `https://music.youtube.com/youtubei/v1/search?alt=json&key=${KEY}&prettyPrint=false`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'X-Goog-Api-Format-Version': '2', 'user-agent': 'Mozilla/5.0' } },
    { name: 'E youtubei on www.youtube.com host', url: `https://www.youtube.com/youtubei/v1/search?alt=json&key=${KEY}&prettyPrint=false`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'Mozilla/5.0', 'X-Goog-Api-Format-Version': '2' } },
  ];
  for (const v of variants) {
    try {
      const r = await fetch(v.url, { method: 'POST', headers: v.headers, body });
      const text = await r.text();
      const ok = r.status === 200 && text.trimStart().startsWith('{') && !text.includes('"error"');
      console.log(`\n=== ${v.name}\n  status ${r.status}, ${text.length} bytes ${ok ? '✅ OK' : '❌'}`);
      console.log('  body:', text.slice(0, 400).replace(/\s+/g, ' '));
    } catch (e) { console.log(`\n=== ${v.name}\n  threw ${String(e).slice(0, 200)}`); }
    await new Promise(r => setTimeout(r, 1500));
  }
})();
