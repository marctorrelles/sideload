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
  { id: 'pl:a', kind: 'playlist', name: 'Deep Focus', total: 312, moved: 312, review: 1, status: 'done', ytId: 'PL1' },
  { id: 'liked', kind: 'liked', name: 'Liked songs', total: 2911, moved: running ? 2268 : 2904, review: 2, status: running ? 'writing' : 'done', ytId: 'PL2' },
  { id: 'pl:b', kind: 'playlist', name: "road trip '24", total: 91, moved: 88, review: 1, status: 'done', ytId: 'PL3' },
  { id: 'pl:c', kind: 'playlist', name: 'kitchen sessions', total: 204, moved: running ? 0 : 203, review: 1, status: running ? 'queued' : 'done', ytId: running ? null : 'PL4' },
  { id: 'pl:d', kind: 'playlist', name: 'CRYStal (x)', total: 75, moved: 0, review: 1, status: 'failed', ytId: null },
  { id: 'al:1', kind: 'album', name: 'Selected Ambient Works 85-92', total: 1, moved: running ? 0 : 1, review: 0, status: running ? 'queued' : 'done', ytId: null },
  { id: 'ar:1', kind: 'artist', name: 'Aphex Twin', total: 1, moved: running ? 0 : 1, review: 0, status: running ? 'queued' : 'done', ytId: null },
];
const job = (id, status) => ({ id, status, failure: status === 'failed' ? 'auth_expired' : null,
  totals: { tracks: 5288, moved: status === 'running' ? 3304 : 5281, review: 7, skipped: 0, collapsed: 1, writeFailed: 1 }, items: items(status === 'running'), review, reviewTotal: 7,
  startedAt: Date.now() - 372_000, finishedAt: status === 'running' ? null : Date.now() - 1000, ratePerMin: 44, etaSeconds: 130, throttledUntil: null, ytConnected: true, searches: 3100, cacheHits: 940 });
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const json = (b, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (p === '/api/session') return json({ spotify: { displayName: 'Marc', email: 'marc@example.com', clientId: 'x'.repeat(32), counts: { playlists: 70, liked: 3036 } }, destination: { provider: 'ytmusic', account: { title: 'Marc Torrelles', handle: '@marctorrelles' } } });
  if (p === '/api/library') return json(lib);
  if (p === '/api/stats') return json({ tracksMoved: 12480, jobs: 31, matchRate: 0.964, medianMinutes: 41 });
  let m = p.match(/^\/api\/jobs\/([a-z0-9]{26})$/); if (m) return m[1][0] === 'r' ? json(job(m[1], 'running')) : m[1][0] === 'd' ? json(job(m[1], 'done')) : m[1][0] === 'f' ? json(job(m[1], 'failed')) : json({ error: 'not_found' }, 404);
  if (/\/review$/.test(p)) return json([]);
  if (/\/search$/.test(p)) return json([{ videoId: 'abcdefghijk', title: 'Untitled (Selected Ambient Works)', artists: 'Aphex Twin', album: 'SAW 85-92', durationSec: 293 }]);
  return json({ ok: true });
}).listen(8787, '127.0.0.1', () => console.log('mock api on 8787'));
