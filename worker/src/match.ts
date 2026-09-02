// worker/src/match.ts — ported from sigma67/spotify_to_ytmusic utils/match.py (MIT), with a confidence gate added
import type { SpotifyTrack } from './spotify';
import type { SearchSong } from './innertube';

export function stripFeat(name: string): string {
  return name
    .replace(/\s*[\(\[]\s*(feat|ft|featuring|with)\.?\s[^\)\]]*[\)\]]/gi, '')
    .replace(/\s+-\s+(feat|ft)\.?\s.*$/i, '')
    .trim();
}
export function buildQuery(t: { name: string; artists: string[] }): string {
  return `${t.artists[0] ?? ''} ${stripFeat(t.name)}`.replace(/ &/g, '').replace(/\s+/g, ' ').trim();
}
/** Global cache key: primary artist | title, lowercase, accents stripped, punctuation collapsed. */
export function cacheKey(t: { name: string; artists: string[] }): string {
  return `${t.artists[0] ?? ''}|${stripFeat(t.name)}`.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}|]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Sørensen–Dice over character bigrams, 0..1. ponytail: close enough to difflib.ratio for titles; swap for Levenshtein if calibration says so. */
export function similarity(a: string, b: string): number {
  const A = a.toLowerCase().trim(), B = b.toLowerCase().trim();
  if (!A || !B) return 0;
  if (A === B) return 1;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const ga = grams(A), gb = grams(B);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  return (2 * hit) / (Math.max(A.length - 1, 1) + Math.max(B.length - 1, 1));
}
export interface Scored { r: SearchSong; score: number; titleSim: number; artistSim: number; durationDelta: number | null }
export function score(t: Pick<SpotifyTrack, 'name' | 'artists' | 'album' | 'durationMs'>, r: SearchSong): Scored {
  const title = r.isSong ? r.title : (r.title.split(' - ')[1] ?? r.title); // videos are often "Artist - Title"
  const titleSim = similarity(stripFeat(title), stripFeat(t.name));
  const artistSim = similarity(r.artists.join(' '), t.artists.join(' '));
  const parts = [titleSim, artistSim];
  let durationDelta: number | null = null;
  if (r.durationSec && t.durationMs) {
    durationDelta = Math.abs(r.durationSec * 1000 - t.durationMs) / 1000;
    parts.push(Math.max(0, 1 - (durationDelta * 2000) / t.durationMs) * 5);
  }
  if (r.isSong && r.album && t.album) parts.push(similarity(r.album, t.album));
  return { r, titleSim, artistSim, durationDelta, score: (parts.reduce((a, b) => a + b, 0) / parts.length) * (r.isSong ? 2 : 1) };
}
export interface Match { best: SearchSong | null; confident: boolean; score: number }
export function pickBest(t: Pick<SpotifyTrack, 'name' | 'artists' | 'album' | 'durationMs'>, results: SearchSong[]): Match {
  const scored = results.filter(r => !r.unavailable && r.title).map(r => score(t, r)).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return { best: null, confident: false, score: 0 };
  const confident = top.titleSim >= 0.6 && top.artistSim >= 0.5 && (top.durationDelta === null || top.durationDelta <= 15);
  return { best: top.r, confident, score: top.score };
}
