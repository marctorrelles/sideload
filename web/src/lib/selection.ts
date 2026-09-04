// web/src/lib/selection.ts: pure helpers for the Choose step.
import type { Library, Selection } from '@shared/types';
export type Tab = 'playlists' | 'albums' | 'artists';
export interface Sel {
  liked: boolean;
  playlists: Set<string>;
  albums: Set<string>;
  artists: Set<string>;
}
/** A Development Mode Spotify app cannot read playlists owned by other users (403, measured 2026-09-02). */
export const selectable = (p: Library['playlists'][number]) => p.ownedByUser;
export const defaultSel = (lib: Library): Sel => ({
  liked: lib.likedCount > 0,
  playlists: new Set(lib.playlists.filter((p) => selectable(p) && !p.isAlgorithmic).map((p) => p.id)),
  albums: new Set(lib.albums.map((a) => a.id)),
  artists: new Set(lib.artists.map((a) => a.id)),
});
export function totals(lib: Library, s: Sel) {
  const songs =
    (s.liked ? lib.likedCount : 0) +
    lib.playlists.filter((p) => s.playlists.has(p.id)).reduce((n, p) => n + (p.trackCount ?? 0), 0);
  return {
    songs,
    playlists: s.playlists.size + (s.liked ? 1 : 0),
    playlistsTotal: lib.playlists.filter(selectable).length + (lib.likedCount > 0 ? 1 : 0),
    albums: s.albums.size,
    artists: s.artists.size,
  };
}
export const triState = (selected: number, total: number): 'all' | 'none' | 'some' =>
  selected === 0 ? 'none' : selected === total ? 'all' : 'some';
/** Shift-click range selection over the visible order. */
export function rangeToggle(
  ids: string[],
  anchor: string | null,
  target: string,
  set: Set<string>,
  on: boolean,
): Set<string> {
  const out = new Set(set);
  const a = anchor ? ids.indexOf(anchor) : -1,
    b = ids.indexOf(target);
  const [lo, hi] = a < 0 ? [b, b] : [Math.min(a, b), Math.max(a, b)];
  for (let i = lo; i <= hi; i++) on ? out.add(ids[i]!) : out.delete(ids[i]!);
  return out;
}
export const sortBy = <T extends { name: string; trackCount?: number | null }>(
  xs: T[],
  mode: 'recent' | 'name' | 'size',
) =>
  mode === 'recent'
    ? xs
    : [...xs].sort((a, b) =>
        mode === 'name' ? a.name.localeCompare(b.name) : (b.trackCount ?? 0) - (a.trackCount ?? 0),
      );
export function toSelection(lib: Library, s: Sel): Selection {
  return {
    liked: s.liked,
    likedCount: lib.likedCount,
    playlists: lib.playlists
      .filter((p) => s.playlists.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        isPublic: p.isPublic === true,
        trackCount: p.trackCount ?? 0,
      })),
    albums: lib.albums.filter((a) => s.albums.has(a.id)).map((a) => ({ id: a.id, name: a.name, artist: a.artist })),
    artists: lib.artists.filter((a) => s.artists.has(a.id)).map((a) => ({ id: a.id, name: a.name })),
  };
}
