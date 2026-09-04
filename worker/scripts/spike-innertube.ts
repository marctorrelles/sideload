// worker/scripts/spike-innertube.ts: run from the repo root: pnpm spike:innertube
// Verifies the YouTube paths the worker relies on and re-records the fixtures in worker/test/fixtures (redacted).
// Findings (2026-09-02): OAuth tokens are rejected by InnerTube WEB_REMIX (400) but accepted by TVHTML5 on www.youtube.com;
// TVHTML5 cannot create playlists ("Precondition check failed") → playlists.insert on the Data API; anonymous WEB_REMIX search works.
// Google's abuse page ("Sorry…", 403 HTML) appears after bursts from one IP: the script waits and retries once per call.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => l.split('=') as [string, string]),
);
const SCOPE = 'https://www.googleapis.com/auth/youtube';
const TOKFILE = '.yt_token.json'; // gitignored cache so reruns do not re-prompt
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0';
const TV_UA =
  'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/2.2 Chrome/63.0.3239.84 TV Safari/537.36';
const P = {
  songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
  artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
};
const pause = (ms = 3000) => new Promise((r) => setTimeout(r, ms));

async function form(url: string, data: Record<string, string>) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data),
  });
  return r.json() as Promise<any>;
}
async function getToken(): Promise<string> {
  if (existsSync(TOKFILE)) {
    const t = JSON.parse(readFileSync(TOKFILE, 'utf8'));
    if (t.expiresAt > Date.now() + 60_000) return t.access;
    const r = await form('https://oauth2.googleapis.com/token', {
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: t.refresh,
      grant_type: 'refresh_token',
    });
    if (r.access_token) {
      writeFileSync(
        TOKFILE,
        JSON.stringify({ access: r.access_token, refresh: t.refresh, expiresAt: Date.now() + r.expires_in * 1000 }),
      );
      return r.access_token;
    }
  }
  const dc = await form('https://oauth2.googleapis.com/device/code', {
    client_id: env.GOOGLE_CLIENT_ID!,
    scope: SCOPE,
  });
  console.log('Open', dc.verification_url, 'and enter', dc.user_code);
  for (;;) {
    await pause((dc.interval ?? 5) * 1000);
    const t = await form('https://oauth2.googleapis.com/token', {
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      device_code: dc.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (t.access_token) {
      writeFileSync(
        TOKFILE,
        JSON.stringify({
          access: t.access_token,
          refresh: t.refresh_token,
          expiresAt: Date.now() + t.expires_in * 1000,
        }),
      );
      return t.access_token;
    }
    if (t.error !== 'authorization_pending' && t.error !== 'slow_down') throw new Error(JSON.stringify(t));
  }
}
async function post(
  label: string,
  url: string,
  headers: Record<string, string>,
  body: object,
  retry = true,
): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  if (r.status === 403 && text.includes('<title>Sorry')) {
    console.log(`${label} → abuse page${retry ? '; waiting 45 s, retrying once' : ''}`);
    if (!retry) return null;
    await pause(45_000);
    return post(label, url, headers, body, false);
  }
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {}
  console.log(
    `${label} → ${r.status}${j?.error ? ' ❌ ' + String(j.error.message ?? '').slice(0, 100) : j ? ' ✅' : ' ❌ ' + text.slice(0, 80)}`,
  );
  return j;
}
const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const anon = (endpoint: string, body: object) =>
  post(
    `ANON ${endpoint}`,
    `https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`,
    {
      'content-type': 'application/json',
      'user-agent': UA,
      origin: 'https://music.youtube.com',
      'x-origin': 'https://music.youtube.com',
    },
    {
      ...body,
      context: { client: { clientName: 'WEB_REMIX', clientVersion: `1.${d}.01.00`, hl: 'en', gl: 'US' }, user: {} },
    },
  );
const tv = (token: string, endpoint: string, body: object) =>
  post(
    `TV ${endpoint}`,
    `https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`,
    { 'content-type': 'application/json', 'user-agent': TV_UA, authorization: `Bearer ${token}` },
    {
      ...body,
      context: { client: { clientName: 'TVHTML5', clientVersion: '7.20250120.19.00', hl: 'en', gl: 'US' }, user: {} },
    },
  );
async function dataApi(token: string, method: string, path: string, body?: object) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {}
  console.log(`DATA ${method} ${path.split('?')[0]} → ${r.status}${j?.error ? ' ❌ ' + j.error.message : ' ✅'}`);
  return j;
}
const redact = (o: any): any =>
  Array.isArray(o)
    ? o.map(redact)
    : o && typeof o === 'object'
      ? Object.fromEntries(
          Object.entries(o).map(([k, v]) => [
            k,
            [
              'visitorData',
              'consistencyTokenJar',
              'encryptedTokenJarContents',
              'datasyncId',
              'onBehalfOfUser',
              'channelTitle',
              'channelId',
            ].includes(k)
              ? 'REDACTED'
              : redact(v),
          ]),
        )
      : o;
const save = (n: string, j: unknown, note = '') =>
  writeFileSync(
    `worker/test/fixtures/${n}.json`,
    JSON.stringify(
      {
        _recorded: `${new Date().toISOString().slice(0, 10)} with worker/scripts/spike-innertube.ts; visitorData/consistencyTokenJar redacted${note}`,
        ...redact(j),
      },
      null,
      1,
    ),
  );

(async () => {
  const token = await getToken();
  // 1. anonymous search + album resolve (the matcher path)
  const s = await anon('search', { query: 'Aphex Twin Xtal', params: P.songs });
  if (s) save('innertube-search-songs', s);
  const videoId = JSON.stringify(s ?? '').match(/"videoId":"([\w-]{11})"/)?.[1];
  console.log('  videoId', videoId);
  await pause();
  const a = await anon('search', { query: 'Aphex Twin Selected Ambient Works 85-92', params: P.albums });
  if (a) save('innertube-search-albums', a);
  const albumBrowseId = JSON.stringify(a ?? '').match(/"browseId":"(MPRE[\w-]+)"/)?.[1];
  await pause();
  const ar = await anon('search', { query: 'Aphex Twin', params: P.artists });
  if (ar) save('innertube-search-artists', ar);
  const channelId = JSON.stringify(ar ?? '').match(/"browseId":"(UC[\w-]{22})"/)?.[1];
  await pause();
  let albumPl: string | undefined;
  if (albumBrowseId) {
    const b = await anon('browse', { browseId: albumBrowseId });
    if (b) save('innertube-browse-album', { microformat: b.microformat, contents: {} }, '; trimmed to microformat');
    albumPl = String(b?.microformat?.microformatDataRenderer?.urlCanonical ?? '').match(/list=([\w-]+)/)?.[1];
    await pause();
  }
  if (!videoId) throw new Error('anonymous search failed twice; wait a few minutes and rerun');
  // 2. create (Data API) + writes (TV)
  const c = await dataApi(token, 'POST', 'playlists?part=snippet,status', {
    snippet: { title: 'sideload spike (delete me)' },
    status: { privacyStatus: 'private' },
  });
  save('data-playlist-insert', c);
  const pl: string = c.id;
  await pause();
  save(
    'innertube-edit-playlist',
    await tv(token, 'browse/edit_playlist', {
      playlistId: pl,
      actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }],
    }),
  );
  await pause();
  save('innertube-like', await tv(token, 'like/like', { target: { videoId } }));
  await pause();
  if (albumPl) {
    await tv(token, 'like/like', { target: { playlistId: albumPl } });
    await pause();
  }
  if (channelId) {
    save('innertube-subscribe', await tv(token, 'subscription/subscribe', { channelIds: [channelId] }));
    await pause(5000);
  }
  // 3. read-backs (Data API)
  const di = await dataApi(token, 'GET', `playlistItems?part=contentDetails&maxResults=50&playlistId=${pl}`);
  save('data-playlist-items', di);
  console.log('  playlist read-back has the video:', JSON.stringify(di).includes(videoId));
  const ll = await dataApi(token, 'GET', 'playlistItems?part=contentDetails&maxResults=50&playlistId=LL');
  ll.items = ll.items.slice(0, 3);
  save('data-playlist-items-ll', ll, '; items trimmed to 3');
  console.log('  LL total:', ll.pageInfo?.totalResults);
  // 4. undo everything
  await pause();
  await tv(token, 'like/removelike', { target: { videoId } });
  if (albumPl) {
    await pause();
    await tv(token, 'like/removelike', { target: { playlistId: albumPl } });
  }
  if (channelId) {
    await pause();
    await tv(token, 'subscription/unsubscribe', { channelIds: [channelId] });
  }
  await pause();
  await dataApi(token, 'DELETE', `playlists?id=${pl}`);
  console.log(
    '\nDONE. Fixtures rewritten; run pnpm --filter worker test. Then: cd worker/test/fixtures && grep -l "@gmail" *.json || echo clean',
  );
})();
