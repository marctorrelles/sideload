// worker/test/match.test.ts
import { describe, it, expect } from 'vitest';
import { stripFeat, buildQuery, cacheKey, similarity, pickBest } from '../src/match';
const t = { id: 'x', name: 'Xtal', artists: ['Aphex Twin'], album: 'Selected Ambient Works 85-92', durationMs: 293_000, isLocal: false, isEpisode: false, addedAt: null };
const song = (o: Partial<import('../src/innertube').SearchSong>) => ({ videoId: 'v', title: 'Xtal', artists: ['Aphex Twin'], album: 'Selected Ambient Works 85-92', durationSec: 293, isSong: true, unavailable: false, ...o });

describe('match', () => {
  it('strips feat and builds the query without ampersands', () => {
    expect(stripFeat('Song (feat. Someone)')).toBe('Song');
    expect(stripFeat('Song - feat. Someone')).toBe('Song');
    expect(buildQuery({ name: 'DtMF (feat. X)', artists: ['Bad Bunny', 'Y'] })).toBe('Bad Bunny DtMF');
    expect(buildQuery({ name: 'Jazz', artists: ['Simon & Garfunkel'] })).toBe('Simon Garfunkel Jazz');
  });
  it('cache key is accent/punctuation/case insensitive', () => {
    expect(cacheKey({ name: 'Déjà Vu!', artists: ['Beyoncé'] })).toBe(cacheKey({ name: 'deja vu', artists: ['BEYONCE'] }));
  });
  it('similarity', () => { expect(similarity('Xtal', 'Xtal')).toBe(1); expect(similarity('Xtal', 'zzzz')).toBe(0); expect(similarity('Untitled', 'Untitled (Selected Ambient Works)')).toBeGreaterThan(0.3); }); // Dice bigrams ≈ 0.36 here; pickBest's 0.6 title gate still sends it to review
  it('prefers the song over the video with the same title', () => {
    const m = pickBest(t, [song({ videoId: 'video', isSong: false, album: null }), song({ videoId: 'song' })]);
    expect(m.best!.videoId).toBe('song'); expect(m.confident).toBe(true);
  });
  it('prefers the exact title on a single over a variant title on the right album', () => {
    // calibration 2026-09-03: album agreement at full weight used to outvote the title
    const m = pickBest(t, [song({ videoId: 'variant', title: 'Xtal (Gym Cover)' }), song({ videoId: 'exact', album: 'Xtal' })]);
    expect(m.best!.videoId).toBe('exact');
  });
  it('is not confident when duration is far off or artist differs', () => {
    expect(pickBest(t, [song({ durationSec: 60 })]).confident).toBe(false);
    expect(pickBest(t, [song({ artists: ['Somebody Else'] })]).confident).toBe(false);
  });
  it('skips greyed-out results and returns null when nothing usable', () => {
    expect(pickBest(t, [song({ unavailable: true })]).best).toBeNull();
    expect(pickBest(t, []).best).toBeNull();
  });
});
