import http from 'node:http'; import fs from 'node:fs';
// web/scripts/mock-api.mjs: stand-in for the Worker on 8787 so every screen (connected, Select, running/done/failed transfer) can be checked without real accounts.
// Job ids: any 26-char id starting with r = running, d = done, f = failed. Run: pnpm --filter web mock (with astro dev, instead of wrangler dev).
const F = new URL('../../worker/test/fixtures/', import.meta.url).pathname;
const pl = JSON.parse(fs.readFileSync(F + 'spotify-me-playlists.json', 'utf8')).items;
const al = JSON.parse(fs.readFileSync(F + 'spotify-me-albums.json', 'utf8')).items;
const ar = JSON.parse(fs.readFileSync(F + 'spotify-me-following.json', 'utf8')).artists.items;
const lib = { likedCount: 3036,
  playlists: pl.map(x => ({ id: x.id, name: x.name, description: x.description, owner: x.owner.id === 'me' ? 'you' : x.owner.id, ownedByUser: x.owner.id === 'me', isAlgorithmic: x.owner.id === 'spotify', collaborative: x.collaborative, isPublic: x.public, trackCount: x.items?.total ?? 0, image: null })),
  albums: al.map(x => ({ id: x.album.id, name: x.album.name, artist: x.album.artists.map(a => a.name).join(', '), trackCount: x.album.total_tracks, image: null })),
  artists: ar.map(x => ({ id: x.id, name: x.name, image: null })) };
// DEMO=1: an invented library instead of the recorded one (screenshots for the README must not show a real library)
const DEMO = [['morning coffee', 'you', 84], ["road trip '24", 'you', 91, { isPublic: true }], ['kitchen sessions', 'you', 204], ['slow sundays', 'you', 133], ['wedding · Ana & Joel', 'you', 245, { collaborative: true }], ['gym 2019', 'you', 57], ['Best of 2023', 'you', 100], ['late night drives', 'you', 168], ['Discover Weekly', 'spotify', 30], ['Release Radar', 'spotify', 30], ['Daily Mix 1', 'spotify', 50], ['indie sleaze revival', 'Júlia', 78], ['office focus', 'Tomás', 412], ['summer bbq', 'Ana', 66]];
if (process.env.DEMO) {
  lib.likedCount = 2911;
  // invented covers: a small SVG per playlist (data: is in the CSP img-src); algorithmic ones stay without artwork
  const cover = i => { const [a, b] = [['#c4552b', '#2b1a12'], ['#3d6b8f', '#101b24'], ['#b08d3c', '#2a2113'], ['#5a7a4e', '#141c12'], ['#8c4a7d', '#1d1220'], ['#c9c2b3', '#33302a']][i % 6]; const shape = ['<circle cx="18" cy="18" r="9" fill="' + b + '" opacity=".8"/>', '<rect x="6" y="20" width="24" height="10" fill="' + b + '" opacity=".8"/>', '<path d="M0 36L36 0v36z" fill="' + b + '" opacity=".7"/>', '<circle cx="26" cy="10" r="6" fill="' + b + '"/><circle cx="12" cy="24" r="6" fill="' + b + '" opacity=".6"/>'][i % 4]; return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="36" height="36" fill="url(#g)"/>' + shape + '</svg>'); };
  lib.playlists = DEMO.map(([name, owner, trackCount, extra = {}], i) => ({ id: `demo${i}`, name, description: '', owner, ownedByUser: owner === 'you', isAlgorithmic: owner === 'spotify', collaborative: !!extra.collaborative, isPublic: extra.isPublic ?? false, trackCount, image: owner === 'spotify' ? null : cover(i) }));
}
const rv = (id, t, a, itemName, reason, extra = {}) => ({ id, kind: 'playlist', title: t, artist: a, itemName, reason, suggestion: null, collidesWith: null, actionable: reason !== 'local_file', ...extra });
const review = [
  rv(1, 'Untitled', 'Aphex Twin', 'Deep Focus', 'low_confidence', { suggestion: { videoId: 'abcdefghijk', title: 'Untitled (Selected Ambient Works)', artists: 'Aphex Twin' } }),
  rv(2, 'demo_v3.mp3', 'Local file', 'Liked songs', 'local_file'),
  rv(3, 'DtMF (remix)', 'Bad Bunny', "road trip '24", 'unavailable'),
  rv(4, 'Xtal (Remastered)', 'Aphex Twin', 'Liked songs', 'duplicate_match', { collidesWith: 'Xtal', suggestion: { videoId: 'abcdefghijk', title: 'the same video as "Xtal"', artists: '' } }),
  rv(5, 'Godspeed (live)', 'Frank Ocean', 'Liked songs', 'write_failed', { suggestion: { videoId: 'abcdefghijk', title: 'the same video, added again', artists: '' } }),
  rv(6, 'Sing Sing', 'Rob Reynolds', 'kitchen sessions', 'no_match'),
  rv(7, "CRYStal (x)", '', 'Playlists', 'not_accessible', { actionable: false, id: -3 }),
];
const items = (running) => [
  { id: 'pl:a', kind: 'playlist', name: 'Deep Focus', total: 312, moved: 312, matched: 0, review: 1, status: 'done', ytId: 'PL1' },
  { id: 'liked', kind: 'liked', name: 'Liked songs', total: 2911, moved: running ? 2268 : 2904, matched: running ? 212 : 0, review: 2, status: running ? 'writing' : 'done', ytId: 'PL2' },
  { id: 'pl:b', kind: 'playlist', name: "road trip '24", total: 91, moved: 88, matched: 0, review: 1, status: 'done', ytId: 'PL3' },
  { id: 'pl:c', kind: 'playlist', name: 'kitchen sessions', total: 204, moved: running ? 0 : 203, matched: 0, review: 1, status: running ? 'queued' : 'done', ytId: running ? null : 'PL4' },
  { id: 'pl:d', kind: 'playlist', name: 'CRYStal (x)', total: 75, moved: 0, matched: 0, review: 1, status: 'failed', ytId: null },
  { id: 'al:1', kind: 'album', name: 'Selected Ambient Works 85-92', total: 1, moved: running ? 0 : 1, matched: 0, review: 0, status: running ? 'queued' : 'done', ytId: null },
  { id: 'ar:1', kind: 'artist', name: 'Aphex Twin', total: 1, moved: running ? 0 : 1, matched: 0, review: 0, status: running ? 'queued' : 'done', ytId: null },
];
const FEED = [['read', 'Reading "kitchen sessions"', 'from Spotify'], ['match', 'Bad Bunny · DtMF', null], ['match', 'Aphex Twin · Xtal', 'from the shared cache'], ['review', 'Frank Ocean · Godspeed (live)', 'needs a look'], ['add', 'Added 50 songs to "Liked Songs"', null], ['match', "Kylie Minogue · Can't Get You out of My Head", null], ['verify', 'Checked "Deep Focus" on YouTube', 'all 312 there'], ['entity', 'Followed Aphex Twin', null], ['match', 'New Order · Blue Monday', null], ['review', 'Rob Reynolds · Sing Sing', 'no match found'], ['create', 'Created "kitchen sessions"', 'private playlist'], ['throttle', 'YouTube asked us to slow down', 'retrying in 5 s'], ['match', 'Bronski Beat · Smalltown Boy', null], ['match', 'Daft Punk · Around the World', null], ['add', 'Added 50 songs to "kitchen sessions"', null], ['match', 'Radiohead · Karma Police', null]];
// a new line every 3 s while running, so the feed can be watched arriving
const recent = (running) => running ? FEED.slice(0, 12 + Math.floor(Date.now() / 3000) % 5).slice(-12).map(([kind, text, sub], i, a) => ({ kind, text, sub, videoId: null, at: Date.now() - (a.length - i) * 3000 })) : [];
const COVERS = 'sWcLccMuCA8 o6nYFg2fzkU iOEJHNZpeck 8PGppDW8kD0 zw-2CTx4YgY 604ZHYmCfwE fNd7eZxDQ0w v5ec5SfoB6U SA0-V9FJKno LunrTjGIQ70 ZtzqhGl7Ad0 NUmcdjhepBU 4jX07JqDARc x9Va60gOq1A DfblKsP65mY K_RhPvytiW4 1ruDdkXfCHU lSHpDGLoJaQ hRPP-KIqyaA zL3sGlLuGhg wL-LuC9UPvc 5Rk8u2FTaG0 Wx7I4yWJnXI Xxk-ryO6J2I OtAweb0IV14 2tOutF8B3f8 uXpKC8TIAxE grzL8THFlUs R1MBI2tSHe0 a8dzSKRtctU y3OBsTTUsjk 3yFwVfW_XXc VZN47sUFI2o LeGwJLjwhd0 ww9qOeKapg4 SeglB339Dds -VLbtlFCyhQ XicJMo1HC6M EU79S-pFmn0 -4QoCMvoHjA kgEEZJF_2bw Mj2jjJNl_ac r9F2FrmnUdk sQFi6tvJJk4 uat_W1SwsZ4'.split(' ');
const covers = (running) => running ? COVERS.slice(0, 20 + Math.floor(Date.now() / 3000) % 26) : COVERS;
const job = (id, status) => ({ recent: recent(status === 'running'), covers: covers(status === 'running'), id, status, failure: status === 'failed' ? 'auth_expired' : null,
  totals: { tracks: 5288, moved: status === 'running' ? 3304 : 5281, matched: status === 'running' ? 212 : 0, review: 7, skipped: 0, collapsed: 1, writeFailed: 1 }, items: items(status === 'running'), review, reviewTotal: 7,
  startedAt: Date.now() - 372_000, finishedAt: status === 'running' ? null : Date.now() - 1000, ratePerMin: 44, etaSeconds: 130, throttledUntil: null, ytConnected: true, searches: 3100, cacheHits: 940 });
// static files from web/dist with the Worker's html_handling: /connect → connect.html, /t/<id> → t/index.html
const DIST = new URL('../dist/', import.meta.url).pathname;
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', txt: 'text/plain', xml: 'application/xml', json: 'application/json' };
function serveStatic(p, res) {
  if (/^\/t\/[a-z0-9]{26}$/.test(p)) p = '/t/index.html';
  const candidates = [p, `${p}.html`, `${p.replace(/\/$/, '')}/index.html`, p === '/' ? '/index.html' : null].filter(Boolean);
  for (const c of candidates) { const f = DIST + c.replace(/^\//, ''); if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[f.split('.').pop()] ?? 'application/octet-stream' }); return res.end(fs.readFileSync(f)); } }
  res.writeHead(404, { 'content-type': 'text/html' }); res.end(fs.existsSync(DIST + '404.html') ? fs.readFileSync(DIST + '404.html') : 'not found');
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const json = (b, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (p === '/api/session') return json({ spotify: { displayName: 'Marc', email: 'marc@example.com', clientId: 'x'.repeat(32), counts: { playlists: 70, liked: 3036 } }, destination: { provider: 'ytmusic', account: { title: 'Marc Torrelles', handle: '@marctorrelles' } } });
  if (p === '/api/library') return json(lib);
  if (p === '/api/stats') return json({ tracksMoved: 12480, jobs: 31, matchRate: 0.964, medianMinutes: 41 });
  let m = p.match(/^\/api\/jobs\/([a-z0-9]{26})$/); if (m) return m[1][0] === 'r' ? json(job(m[1], 'running')) : m[1][0] === 'd' ? json(job(m[1], 'done')) : m[1][0] === 'f' ? json(job(m[1], 'failed')) : json({ error: 'not_found' }, 404);
  if (/\/review$/.test(p)) return json([]);
  if (/\/search$/.test(p)) return json([{ videoId: 'abcdefghijk', title: 'Untitled (Selected Ambient Works)', artists: 'Aphex Twin', album: 'SAW 85-92', durationSec: 293 }]);
  if (req.method === 'GET' && !p.startsWith('/api') && !p.startsWith('/auth')) return serveStatic(p, res); // the built site, so this doubles as a QA server
  return json({ ok: true });
}).listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => console.log(`mock api on ${process.env.PORT ?? 8787}`));
