import { it, expect } from 'vitest';
import { defaultSel, totals, triState, rangeToggle, sortBy, toSelection } from '../src/lib/selection';
const pl = (id: string, name: string, trackCount: number, extra: object = {}) => ({
  id,
  name,
  description: null,
  owner: 'you',
  ownedByUser: true,
  isAlgorithmic: false,
  collaborative: false,
  isPublic: true,
  trackCount,
  image: null,
  ...extra,
});
const lib = {
  likedCount: 2911,
  playlists: [
    pl('a', 'Deep Focus', 312),
    pl('b', 'Discover Weekly', 30, { owner: 'Spotify', ownedByUser: false, isAlgorithmic: true }),
    pl('c', 'CRYStal', 75, { owner: 'laura', ownedByUser: false }),
  ],
  albums: [],
  artists: [],
};
it('algorithmic and other-people playlists start unchecked; totals count liked as a playlist and exclude unreadable ones', () => {
  const s = defaultSel(lib);
  expect(s.playlists.has('b')).toBe(false);
  expect(s.playlists.has('c')).toBe(false);
  expect(s.playlists.has('a')).toBe(true);
  expect(totals(lib, s)).toMatchObject({ songs: 3223, playlists: 2, playlistsTotal: 2 });
  expect(triState(2, 3)).toBe('some');
  expect(triState(0, 3)).toBe('none');
  expect(triState(3, 3)).toBe('all');
});
it('shift-click selects a range; sort by name/size', () => {
  expect([...rangeToggle(['a', 'b', 'c', 'd'], 'a', 'c', new Set(), true)]).toEqual(['a', 'b', 'c']);
  expect([...rangeToggle(['a', 'b', 'c'], null, 'b', new Set(['a', 'b']), false)]).toEqual(['a']);
  expect(sortBy(lib.playlists, 'size').map((p) => p.id)).toEqual(['a', 'c', 'b']);
  expect(sortBy(lib.playlists, 'name')[0]!.id).toBe('c');
});
it('toSelection carries names and counts', () => {
  const sel = toSelection(lib, defaultSel(lib));
  expect(sel).toMatchObject({
    liked: true,
    likedCount: 2911,
    playlists: [{ id: 'a', name: 'Deep Focus', isPublic: true, trackCount: 312 }],
  });
});
