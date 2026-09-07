// worker/src/routes-validate.ts
import type { Selection } from '@shared/types';
import { HttpError } from './http';
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
export function validateSelection(b: unknown): Selection {
  const o = (b ?? {}) as Record<string, unknown>;
  const playlists = Array.isArray(o.playlists) ? o.playlists : [];
  const albums = Array.isArray(o.albums) ? o.albums : [];
  const artists = Array.isArray(o.artists) ? o.artists : [];
  // Each new playlist costs 50 Data API units against a 10,000/day project quota, so ~200 a day is the real ceiling;
  // past it the job parks until midnight Pacific and then dies on JOB_TIMEOUT_MS. Fail here instead, hours earlier.
  // ponytail: one shared project quota, so two big transfers on one day still collide. Raise to 500 once the quota
  // increase is granted. Albums and artists go through InnerTube and cost no units, hence the looser caps.
  if (playlists.length > 180)
    throw new HttpError(
      413,
      'too_many_items',
      'More than 180 playlists in one transfer. YouTube only allows about 200 new playlists a day, so split it in two.',
    );
  if (albums.length > 2000 || artists.length > 2000) throw new HttpError(413, 'too_many_items');
  for (const p of playlists)
    if (
      !SPOTIFY_ID.test(p?.id) ||
      !str(p?.name, 200) ||
      typeof p?.isPublic !== 'boolean' ||
      !(p?.description == null || str(p.description, 1000)) ||
      !Number.isInteger(p?.trackCount) ||
      p.trackCount < 0
    )
      throw new HttpError(400, 'bad_playlist');
  for (const a of albums)
    if (!SPOTIFY_ID.test(a?.id) || !str(a?.name, 200) || !str(a?.artist ?? '', 200))
      throw new HttpError(400, 'bad_album');
  for (const a of artists) if (!SPOTIFY_ID.test(a?.id) || !str(a?.name, 200)) throw new HttpError(400, 'bad_artist');
  const liked = o.liked === true;
  const likedCount = Number.isInteger(o.likedCount) && (o.likedCount as number) >= 0 ? (o.likedCount as number) : 0;
  if (!liked && !playlists.length && !albums.length && !artists.length)
    throw new HttpError(400, 'empty_selection', 'Pick at least one thing to move.');
  return {
    liked,
    likedCount,
    playlists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      isPublic: p.isPublic,
      trackCount: p.trackCount,
    })),
    albums: albums.map((a) => ({ id: a.id, name: a.name, artist: a.artist ?? '' })),
    artists: artists.map((a) => ({ id: a.id, name: a.name })),
  };
}
