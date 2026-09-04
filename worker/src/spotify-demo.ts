// worker/src/spotify-demo.ts: a built-in Spotify library for reviewers (Google's OAuth verification team) and demos.
// Pasting the REVIEW_CODE secret as the Client ID on the Connect step connects this library instead of a real Spotify
// account; the YouTube side stays real. The client serves these Spotify-shaped answers when the access token is DEMO_ACCESS.
import type { Tokens, RawPlaylist, RawEntry, Page } from './spotify';

export const DEMO_ACCESS = 'demo';
export const DEMO_USER = { id: 'sideloaddemo', display_name: 'Sideload demo', email: null as string | null };
export const demoTokens = (clientId: string): Tokens => ({
  access: DEMO_ACCESS,
  refresh: DEMO_ACCESS,
  expiresAt: Number.MAX_SAFE_INTEGER,
  clientId,
});

const id = (s: string) => `demo${s}`.padEnd(22, '0'); // validateSelection wants 22 alphanumerics, like Spotify's
const cover = (h: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${h} 45% 40%)"/><stop offset="1" stop-color="hsl(${h + 40} 50% 18%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="68" cy="34" r="16" fill="hsl(${h + 20} 60% 70% / .55)"/></svg>`)}`;
type T = [name: string, artist: string, album: string, sec: number];
const entries = (tracks: T[]): RawEntry[] =>
  tracks.map(([name, artist, album, sec], i) => ({
    added_at: `2026-01-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
    is_local: false,
    item: {
      id: id(`t${i}${name.replace(/[^a-z]/gi, '').slice(0, 8)}`),
      name,
      type: 'track',
      duration_ms: sec * 1000,
      artists: [{ name: artist }],
      album: { name: album },
      is_local: false,
    },
  }));

const PLAYLISTS: { id: string; name: string; description: string; hue: number; tracks: T[] }[] = [
  {
    id: id('roadtrip'),
    name: 'Road trip',
    description: 'Windows down.',
    hue: 28,
    tracks: [
      ['Get Lucky', 'Daft Punk', 'Random Access Memories', 369],
      ['Blinding Lights', 'The Weeknd', 'After Hours', 200],
      ["Don't Stop Me Now", 'Queen', 'Jazz', 209],
      ['Dreams', 'Fleetwood Mac', 'Rumours', 257],
      ['Hey Ya!', 'OutKast', 'Speakerboxxx/The Love Below', 235],
      ['Levitating', 'Dua Lipa', 'Future Nostalgia', 203],
      ['The Less I Know the Better', 'Tame Impala', 'Currents', 216],
      ['Africa', 'Toto', 'Toto IV', 295],
    ],
  },
  {
    id: id('latenights'),
    name: 'Late nights',
    description: '',
    hue: 250,
    tracks: [
      ['Nude', 'Radiohead', 'In Rainbows', 255],
      ['Holocene', 'Bon Iver', 'Bon Iver, Bon Iver', 337],
      ['Pink + White', 'Frank Ocean', 'Blonde', 184],
      ['Glory Box', 'Portishead', 'Dummy', 305],
      ['Teardrop', 'Massive Attack', 'Mezzanine', 331],
    ],
  },
];
const LIKED: T[] = [
  ['Smells Like Teen Spirit', 'Nirvana', 'Nevermind', 301],
  ['Rolling in the Deep', 'Adele', '21', 228],
  ['Billie Jean', 'Michael Jackson', 'Thriller', 294],
  ['Do I Wanna Know?', 'Arctic Monkeys', 'AM', 272],
  ['bad guy', 'Billie Eilish', 'When We All Fall Asleep, Where Do We Go?', 194],
];
export const DEMO_COUNTS = { playlists: PLAYLISTS.length, liked: LIKED.length };

const page = <X>(items: X[], offset: number): Page<X> => ({
  items: items.slice(offset, offset + 50),
  total: items.length,
  next: null,
});

/** Spotify-shaped answer for the paths the client uses; null for anything else (the client turns it into a 404). */
export function demoGet(path: string): unknown | null {
  const u = new URL(path, 'https://api.spotify.com/v1/');
  const offset = Number(u.searchParams.get('offset') ?? 0);
  const p = u.pathname.replace(/^\/v1/, '');
  if (p === '/me') return DEMO_USER;
  if (p === '/me/playlists')
    return page<RawPlaylist>(
      PLAYLISTS.map((pl) => ({
        id: pl.id,
        name: pl.name,
        description: pl.description,
        public: false,
        collaborative: false,
        owner: { id: DEMO_USER.id, display_name: DEMO_USER.display_name },
        images: [{ url: cover(pl.hue) }],
        items: { total: pl.tracks.length },
      })),
      0,
    );
  const items = p.match(/^\/playlists\/([^/]+)\/items$/);
  if (items) {
    const pl = PLAYLISTS.find((x) => x.id === items[1]);
    return pl ? page(entries(pl.tracks), offset) : null;
  }
  if (p === '/me/tracks') return page(entries(LIKED), offset);
  if (p === '/me/albums')
    return page(
      [
        {
          album: {
            id: id('albumram'),
            name: 'Random Access Memories',
            artists: [{ name: 'Daft Punk' }],
            total_tracks: 13,
            images: [{ url: cover(45) }],
          },
        },
      ],
      0,
    );
  if (p === '/me/following')
    return {
      artists: {
        items: [{ id: id('artisttame'), name: 'Tame Impala', images: [{ url: cover(300) }] }],
        cursors: { after: null },
        total: 1,
      },
    };
  return null;
}
