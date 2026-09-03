// worker/scripts/calibrate-match.ts: replays the recorded Spotify tracks through live anonymous search and compares pickBest
// with the choices of the Python tool the author's own migration used (~/Library/Caches/spotify_to_ytmusic/lookup.json,
// 3,4k "artists title" → videoId pairs, accepted by inspection). Run from the repo root: pnpm calibrate
// CALIB_CACHE=/path/to.json keeps the search results on disk so scoring changes can be replayed offline.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { InnerTube, type SearchSong } from '../src/innertube';
import { buildQuery, pickBest, stripFeat } from '../src/match';
import { toTrack } from '../src/spotify';

const home = process.env.HOME!;
const lookup = JSON.parse(readFileSync(`${home}/Library/Caches/spotify_to_ytmusic/lookup.json`, 'utf8')) as Record<string, string>;
const fx = (f: string) => JSON.parse(readFileSync(`worker/test/fixtures/${f}`, 'utf8')).items as Parameters<typeof toTrack>[0][];
const entries = [...fx('spotify-me-tracks.json'), ...fx('spotify-playlist-items.json')];
const cachePath = process.env.CALIB_CACHE;
const cache: Record<string, SearchSong[]> = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const yt = new InnerTube(null);
const keysOf = (t: { artists: string[]; name: string }) => [`${t.artists.join(' ')} ${stripFeat(t.name)}`.replace(/ &/g, ''), `${t.artists.join(' ')} ${t.name}`, `${t.artists[0] ?? ''} ${t.name}`];
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let n = 0, agree = 0, soft = 0, confident = 0, confAgree = 0, confSoft = 0, noKey = 0, noResult = 0;
const disagree: string[] = [];
for (const e of entries) {
  const t = toTrack(e); if (!t || t.isLocal || t.isEpisode) continue;
  const expected = keysOf(t).map(k => lookup[k]).find(Boolean); if (!expected) { noKey++; continue; }
  const q = buildQuery(t);
  let results = cache[q];
  if (!results) { results = cache[q] = await yt.searchSongs(q); await new Promise(r => setTimeout(r, 1500)); } // be polite to the anonymous endpoint
  const m = pickBest(t, results); n++;
  if (!m.best) { noResult++; disagree.push(`NONE  ${t.artists[0]} - ${t.name} (expected ${expected})`); continue; }
  const alt = results.find(r => r.videoId === expected);
  const same = m.best.videoId === expected;
  // same title and artists under another video id is the same song uploaded twice, count it as a soft agree
  const sameSong = same || (!!alt && norm(alt.title) === norm(m.best.title) && norm(alt.artists.join(' ')) === norm(m.best.artists.join(' ')));
  if (same) agree++;
  if (sameSong) soft++;
  if (m.confident) { confident++; if (same) confAgree++; if (sameSong) confSoft++; }
  if (!sameSong) {
    disagree.push(`${m.confident ? 'CONF ' : 'low  '} ${t.artists[0]} - ${t.name} | ours ${m.best.videoId} "${m.best.title}" ${m.best.artists} ${m.score.toFixed(2)} | theirs ${expected}${alt ? ` "${alt.title}" ${alt.artists} (in results, rank ${results.indexOf(alt) + 1})` : ' (not in our top results)'}`);
  }
  process.stderr.write(`\r${n} scored`);
}
if (cachePath) writeFileSync(cachePath, JSON.stringify(cache));
const pct = (a: number, b: number) => (b ? +(a / b).toFixed(3) : null);
console.log('\n' + JSON.stringify({ n, noKey, noResult, agree, agreeRate: pct(agree, n), sameSongRate: pct(soft, n), confident, confAgree, confPrecision: pct(confAgree, confident), confSameSongPrecision: pct(confSoft, confident) }, null, 1));
console.log(disagree.join('\n'));
