// worker/src/innertube.ts — hand-port of the ytmusicapi calls we need (MIT, sigma67/ytmusicapi)
const BASE = 'https://music.youtube.com/youtubei/v1/';
const KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30'; // public web client key, same as ytmusicapi
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0';
export const SEARCH_PARAMS = { songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF', videos: 'EgWKAQIQAWoMEA4QChADEAQQCRAF', albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF', artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF' } as const;

export class ThrottleError extends Error { constructor(public status: number, detail = '') { super(`youtube throttled (${status})${detail ? `: ${detail}` : ''}`); } }
export class AuthError extends Error { constructor() { super('youtube auth rejected'); } }

export interface SearchSong { videoId: string; title: string; artists: string[]; album: string | null; durationSec: number | null; isSong: boolean; unavailable: boolean }
export interface SearchAlbum { browseId: string; title: string; artists: string[] }
export interface SearchArtist { channelId: string; name: string }

type J = any;
const runsOf = (col: J): J[] => col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
const browseIdOf = (run: J): string | undefined => run?.navigationEndpoint?.browseEndpoint?.browseId;
const playEndpoint = (r: J): J => r?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;

/** Flattens every musicShelfRenderer in a search response to its list-item renderers. */
export function shelves(res: J): J[] {
  const sections: J[] = res?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  return sections.flatMap(s => s?.musicShelfRenderer?.contents ?? []).map(c => c?.musicResponsiveListItemRenderer).filter(Boolean);
}
export function parseDuration(t: string): number | null {
  const m = t.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return m[3] ? +m[1]! * 3600 + +m[2]! * 60 + +m[3] : +m[1]! * 60 + +m[2]!;
}
export function parseSong(r: J): SearchSong | null {
  const videoId: string | undefined = r?.playlistItemData?.videoId ?? playEndpoint(r)?.videoId;
  if (!videoId) return null;
  const cols = (r.flexColumns ?? []).map(runsOf);
  const title: string = cols[0]?.[0]?.text ?? '';
  const runs: J[] = cols[1] ?? [];
  let artists = runs.filter(x => browseIdOf(x)?.startsWith('UC')).map(x => String(x.text));
  if (!artists.length) artists = (runs.map(x => String(x.text)).join('').split(' • ')[0] ?? '').split(/, | & /).filter(Boolean); // some results carry no artist links (seen 2026-09-02); text fallback
  const album = runs.find(x => browseIdOf(x)?.startsWith('MPRE'))?.text ?? null;
  const type = playEndpoint(r)?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  return { videoId, title, artists, album, durationSec: parseDuration(String(runs.at(-1)?.text ?? '')), isSong: type === 'MUSIC_VIDEO_TYPE_ATV' || album !== null, unavailable: r?.musicItemRendererDisplayPolicy === 'MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT' };
}
export function parseAlbum(r: J): SearchAlbum | null {
  const browseId = r?.navigationEndpoint?.browseEndpoint?.browseId;
  if (typeof browseId !== 'string' || !browseId.startsWith('MPRE')) return null;
  const cols = (r.flexColumns ?? []).map(runsOf);
  return { browseId, title: cols[0]?.[0]?.text ?? '', artists: (cols[1] ?? []).filter((x: J) => browseIdOf(x)?.startsWith('UC')).map((x: J) => String(x.text)) };
}
export function parseArtist(r: J): SearchArtist | null {
  const channelId = r?.navigationEndpoint?.browseEndpoint?.browseId;
  if (typeof channelId !== 'string' || !channelId.startsWith('UC')) return null;
  return { channelId, name: runsOf(r.flexColumns?.[0])?.[0]?.text ?? '' };
}

/** Every value stored under `key` anywhere in a JSON tree. InnerTube moves shelves around; never hardcode a path to them. */
export function findAll(obj: J, key: string, out: J[] = []): J[] {
  if (Array.isArray(obj)) for (const x of obj) findAll(x, key, out);
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (k === key) out.push(v); else findAll(v, key, out); }
  return out;
}
/** One page of a playlist read-back (first page or a continuation page). 2025-style continuations only (`continuation` in the body). */
export function parsePlaylistPage(res: J): { videoIds: string[]; continuation: string | null } {
  const items: J[] = [
    ...findAll(res, 'musicPlaylistShelfRenderer').flatMap((sh: J) => sh?.contents ?? []),
    ...findAll(res, 'appendContinuationItemsAction').flatMap((a: J) => a?.continuationItems ?? []),
  ];
  const videoIds = items.map(i => i?.musicResponsiveListItemRenderer?.playlistItemData?.videoId).filter((v): v is string => typeof v === 'string');
  const continuation: string | null = findAll(items, 'continuationCommand')[0]?.token ?? null;
  return { videoIds, continuation };
}

export interface InnerTubeOptions { timeoutMs?: number }
export class InnerTube {
  private timeoutMs: number;
  constructor(private token: string, opts: InnerTubeOptions = {}) { this.timeoutMs = opts.timeoutMs ?? 30_000; }
  async call(endpoint: string, body: object): Promise<J> {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let r: Response;
    try {
      r = await fetch(`${BASE}${endpoint}?alt=json&key=${KEY}&prettyPrint=false`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://music.youtube.com', 'x-origin': 'https://music.youtube.com', authorization: `Bearer ${this.token}`, 'x-goog-request-time': String(Math.floor(Date.now() / 1000)) },
        body: JSON.stringify({ ...body, context: { client: { clientName: 'WEB_REMIX', clientVersion: `1.${d}.01.00`, hl: 'en', gl: 'US' }, user: {} } }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) { throw new ThrottleError(-1, String(e).slice(0, 120)); } // D17: measured hangs of 4.5+ min with no response — a hang is a retryable failure, never a wait
    if (r.status === 401 || r.status === 403) throw new AuthError();
    if (r.status === 429 || r.status >= 500) throw new ThrottleError(r.status);
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new ThrottleError(0); } // measured: throttled responses are HTML with status 200
  }
  private async search(q: string, params: string): Promise<J[]> { return shelves(await this.call('search', { query: q, params })); }
  async searchSongs(q: string, filter: 'songs' | 'videos' = 'songs'): Promise<SearchSong[]> { return (await this.search(q, SEARCH_PARAMS[filter])).map(parseSong).filter((x): x is SearchSong => !!x); }
  async searchAlbums(q: string): Promise<SearchAlbum[]> { return (await this.search(q, SEARCH_PARAMS.albums)).map(parseAlbum).filter((x): x is SearchAlbum => !!x); }
  async searchArtists(q: string): Promise<SearchArtist[]> { return (await this.search(q, SEARCH_PARAMS.artists)).map(parseArtist).filter((x): x is SearchArtist => !!x); }
  async createPlaylist(title: string, description: string, privacy: 'PRIVATE' | 'PUBLIC' | 'UNLISTED'): Promise<string> {
    const j = await this.call('playlist/create', { title: title.slice(0, 150) || 'Untitled', description: description.slice(0, 1000), privacyStatus: privacy });
    if (typeof j?.playlistId !== 'string') throw new Error('playlist/create returned no playlistId');
    return j.playlistId;
  }
  async addPlaylistItems(playlistId: string, videoIds: string[]): Promise<void> {
    const j = await this.call('browse/edit_playlist', { playlistId, actions: videoIds.map(v => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v, dedupeOption: 'DEDUPE_OPTION_SKIP' })) }); // DEDUPE_OPTION_SKIP = skip the duplicate check (keep intentional duplicates)
    if (j?.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(`edit_playlist: ${j.status}`);
  }
  like(videoId: string) { return this.call('like/like', { target: { videoId } }); }
  likePlaylist(playlistId: string) { return this.call('like/like', { target: { playlistId } }); }
  async albumPlaylistId(browseId: string): Promise<string | null> {
    const j = await this.call('browse', { browseId });
    return String(j?.microformat?.microformatDataRenderer?.urlCanonical ?? '').match(/list=([\w-]+)/)?.[1] ?? null;
  }
  subscribe(channelId: string) { return this.call('subscription/subscribe', { channelIds: [channelId] }); }
  /** All videoIds in a playlist, following continuations. `LM` = liked songs. Used to verify writes (D15). Reads throttle exactly like searches do. */
  async playlistVideoIds(playlistId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    let page = parsePlaylistPage(await this.call('browse', { browseId: playlistId.startsWith('VL') ? playlistId : `VL${playlistId}` }));
    for (let guard = 0; ; guard++) {
      for (const v of page.videoIds) ids.add(v);
      if (!page.continuation || guard > 500) break; // 500 pages ≫ MAX_TRACKS
      page = parsePlaylistPage(await this.call('browse', { continuation: page.continuation }));
    }
    return ids;
  }
  likedVideoIds() { return this.playlistVideoIds('LM'); }
}
