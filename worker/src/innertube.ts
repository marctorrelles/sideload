// worker/src/innertube.ts: YouTube access. Three transports, chosen per operation (verified live 2026-09-02):
//   music: anonymous InnerTube on music.youtube.com: search, album resolve. OAuth tokens are rejected here (400 INVALID_ARGUMENT).
//          App clients (ANDROID_MUSIC, IOS_MUSIC) with retries, WEB_REMIX last: from Cloudflare's egress the web client gets
//          Google's abuse page or a 404 on every call and the app clients get the abuse page on a request here and there
//          (measured 2026-09-03: Android 8/10, iOS 5/5, web 0/5), so one search tries several times before it counts as a throttle.
//   tv:    InnerTube TVHTML5 on www.youtube.com with the user's TV-client OAuth token: add to playlist, like, save album, subscribe.
//          The only InnerTube client that accepts a TV OAuth token; it cannot create playlists ("Precondition check failed").
//   data:  YouTube Data API v3 with the same token: create playlist (50 quota units), read playlists back (1 unit per 50 items).
// Parsers are a hand-port of the ytmusicapi shapes we need (MIT, sigma67/ytmusicapi).
const MUSIC = 'https://music.youtube.com/youtubei/v1/';
const TV = 'https://www.youtube.com/youtubei/v1/';
const DATA = 'https://www.googleapis.com/youtube/v3/';
const MUSIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0';
const ANDROID_UA = 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14) gzip';
const IOS_UA = 'com.google.ios.youtubemusic/7.27.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)';
const MUSIC_PLAN = ['android', 'ios', 'android', 'ios', 'web'] as const;
const TV_UA =
  'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/2.2 Chrome/63.0.3239.84 TV Safari/537.36';
export const SEARCH_PARAMS = {
  songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  videos: 'EgWKAQIQAWoMEA4QChADEAQQCRAF',
  albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
  artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
} as const;

export class ThrottleError extends Error {
  /** `retryAfterMs` is set when the provider told us how long to wait (Data API daily quota → next midnight Pacific). */
  constructor(
    public status: number,
    detail = '',
    public retryAfterMs?: number,
  ) {
    super(`youtube throttled (${status})${detail ? `: ${detail}` : ''}`);
  }
}
export class AuthError extends Error {
  constructor(detail = '') {
    super(`youtube auth rejected${detail ? `: ${detail}` : ''}`);
  }
}

/** The Data API daily quota resets at midnight Pacific; wait until then plus a minute. */
export function msUntilQuotaReset(now = Date.now()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  const secondsIntoDay = (+parts.hour! % 24) * 3600 + +parts.minute! * 60 + +parts.second!;
  return (86_400 - secondsIntoDay) * 1000 + 60_000;
}

export interface SearchSong {
  videoId: string;
  title: string;
  artists: string[];
  album: string | null;
  durationSec: number | null;
  isSong: boolean;
  unavailable: boolean;
}
export interface SearchAlbum {
  browseId: string;
  title: string;
  artists: string[];
  playlistId: string | null; /* the album's OLAK5uy_ playlist when the result carries it */
}
export interface SearchArtist {
  channelId: string;
  name: string;
}

type J = any;
const runsOf = (col: J): J[] => col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
const browseIdOf = (run: J): string | undefined => run?.navigationEndpoint?.browseEndpoint?.browseId;
const playEndpoint = (r: J): J =>
  r?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
    ?.watchEndpoint;

/** Flattens every musicShelfRenderer in a search response to its item renderers (web list items or Android two-column items). */
export function shelves(res: J): J[] {
  const sections: J[] =
    res?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  return sections
    .flatMap((s) => s?.musicShelfRenderer?.contents ?? [])
    .map((c) => c?.musicResponsiveListItemRenderer ?? c?.musicTwoColumnItemRenderer)
    .filter(Boolean);
}
/** Android subtitle: "Artist1, Artist2 • 3:51 • 1B plays" (songs) or "Album • Artist" (albums). */
const androidSegs = (r: J): string[] => String((r?.subtitle?.runs ?? []).map((x: J) => x.text).join('')).split(' • ');
const splitArtists = (s: string): string[] => s.split(/, | & /).filter(Boolean);
export function parseDuration(t: string): number | null {
  const m = t.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return m[3] ? +m[1]! * 3600 + +m[2]! * 60 + +m[3] : +m[1]! * 60 + +m[2]!;
}
export function parseSong(r: J): SearchSong | null {
  if (r?.subtitle) {
    // Android two-column item: no album, no artist links, never greyed out
    const watch = r?.navigationEndpoint?.watchEndpoint;
    if (!watch?.videoId) return null;
    const segs = androidSegs(r);
    const duration = segs.find((s) => /^\d+:\d{2}(?::\d{2})?$/.test(s.trim()));
    const artists = /\d\s*(views|plays)$/.test(segs[0] ?? '') ? [] : splitArtists(segs[0] ?? '');
    const type = watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
    return {
      videoId: watch.videoId,
      title: r?.title?.runs?.[0]?.text ?? '',
      artists,
      album: null,
      durationSec: duration ? parseDuration(duration) : null,
      isSong: type === 'MUSIC_VIDEO_TYPE_ATV' || r?.thumbnailAspectRatio === 'MUSIC_TWO_COLUMN_ITEM_THUMBNAIL_SQUARE',
      unavailable: false,
    };
  }
  const videoId: string | undefined = r?.playlistItemData?.videoId ?? playEndpoint(r)?.videoId;
  if (!videoId) return null;
  const cols = (r.flexColumns ?? []).map(runsOf);
  const title: string = cols[0]?.[0]?.text ?? '';
  const runs: J[] = cols[1] ?? [];
  let artists = runs.filter((x) => browseIdOf(x)?.startsWith('UC')).map((x) => String(x.text));
  if (!artists.length)
    artists = (
      runs
        .map((x) => String(x.text))
        .join('')
        .split(' • ')[0] ?? ''
    )
      .split(/, | & /)
      .filter(Boolean); // some results carry no artist links; text fallback
  const album = runs.find((x) => browseIdOf(x)?.startsWith('MPRE'))?.text ?? null;
  const type = playEndpoint(r)?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  return {
    videoId,
    title,
    artists,
    album,
    durationSec: parseDuration(String(runs.at(-1)?.text ?? '')),
    isSong: type === 'MUSIC_VIDEO_TYPE_ATV' || album !== null,
    unavailable: r?.musicItemRendererDisplayPolicy === 'MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT',
  };
}
export function parseAlbum(r: J): SearchAlbum | null {
  const browseId = r?.navigationEndpoint?.browseEndpoint?.browseId;
  if (typeof browseId !== 'string' || !browseId.startsWith('MPRE')) return null;
  if (r?.subtitle) {
    // Android: "Album • Artist1, Artist2"; the play overlay names the album's playlist
    const overlay = (r?.potentialThumbnailOverlays ?? [])
      .map(
        (o: J) =>
          o?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playbackIdMatchers?.[0]?.playlistId,
      )
      .find(Boolean);
    return {
      browseId,
      title: r?.title?.runs?.[0]?.text ?? '',
      artists: splitArtists(androidSegs(r).slice(1).join(' ')),
      playlistId: typeof overlay === 'string' ? overlay : null,
    };
  }
  const cols = (r.flexColumns ?? []).map(runsOf);
  const pl =
    r?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
      ?.watchPlaylistEndpoint?.playlistId;
  return {
    browseId,
    title: cols[0]?.[0]?.text ?? '',
    artists: (cols[1] ?? []).filter((x: J) => browseIdOf(x)?.startsWith('UC')).map((x: J) => String(x.text)),
    playlistId: typeof pl === 'string' ? pl : null,
  };
}
export function parseArtist(r: J): SearchArtist | null {
  const channelId = r?.navigationEndpoint?.browseEndpoint?.browseId;
  if (typeof channelId !== 'string' || !channelId.startsWith('UC')) return null;
  return { channelId, name: (r?.subtitle ? r?.title?.runs?.[0]?.text : runsOf(r.flexColumns?.[0])?.[0]?.text) ?? '' };
}

export interface InnerTubeOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
}
export class InnerTube {
  private timeoutMs: number;
  private retryDelayMs: number;
  /** `token` may be null for search-only use; every write and read-back needs it. */
  constructor(
    private token: string | null,
    opts: InnerTubeOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retryDelayMs = opts.retryDelayMs ?? 250;
  }

  private async post(url: string, headers: Record<string, string>, body: object): Promise<J> {
    let r: Response;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ThrottleError(-1, String(e).slice(0, 120));
    } // D17: measured hangs of 4.5+ min with no response; a hang is a retryable failure, never a wait
    if (r.status === 401) throw new AuthError();
    if (r.status === 429 || r.status >= 500) throw new ThrottleError(r.status);
    const text = await r.text();
    if (r.status === 403)
      throw text.trimStart().startsWith('{') ? new AuthError('403') : new ThrottleError(403, 'abuse page'); // measured: Google's "Sorry…" HTML page = throttle, not a permission problem
    let j: J;
    try {
      j = JSON.parse(text);
    } catch {
      throw new ThrottleError(0, 'non-JSON 200');
    } // measured: throttled responses can be HTML with status 200
    if (j?.error)
      throw new Error(
        `${url.split('?')[0]?.split('/v1/')[1] ?? url}: ${j.error.status ?? j.error.code} ${String(j.error.message ?? '').slice(0, 120)}`,
      );
    return j;
  }
  /** Anonymous InnerTube on music.youtube.com. The abuse page comes and goes per request (each fetch may leave Cloudflare from
   *  another IP), so a call walks MUSIC_PLAN with growing pauses and only the last failure surfaces as a throttle. */
  async music(endpoint: string, body: object): Promise<J> {
    let last: ThrottleError | undefined;
    for (const [i, client] of MUSIC_PLAN.entries()) {
      try {
        return await this.musicAs(client, endpoint, body);
      } catch (e) {
        if (!(e instanceof ThrottleError)) throw e;
        last = e;
        console.log(
          JSON.stringify({ evt: 'music_retry', endpoint, client, attempt: i + 1, err: e.message.slice(0, 80) }),
        );
        if (i < MUSIC_PLAN.length - 1) await new Promise((r) => setTimeout(r, this.retryDelayMs * (i + 1)));
      }
    }
    throw last;
  }
  async musicAs(client: 'android' | 'ios' | 'web', endpoint: string, body: object): Promise<J> {
    const url = `${MUSIC}${endpoint}?prettyPrint=false`;
    if (client === 'android')
      return this.post(
        url,
        { 'content-type': 'application/json', 'user-agent': ANDROID_UA },
        {
          ...body,
          context: {
            client: {
              clientName: 'ANDROID_MUSIC',
              clientVersion: '7.27.52',
              androidSdkVersion: 34,
              hl: 'en',
              gl: 'US',
            },
            user: {},
          },
        },
      );
    if (client === 'ios')
      return this.post(
        url,
        { 'content-type': 'application/json', 'user-agent': IOS_UA },
        {
          ...body,
          context: {
            client: { clientName: 'IOS_MUSIC', clientVersion: '7.27.1', deviceModel: 'iPhone16,2', hl: 'en', gl: 'US' },
            user: {},
          },
        },
      );
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return this.post(
      url,
      {
        'content-type': 'application/json',
        'user-agent': MUSIC_UA,
        origin: 'https://music.youtube.com',
        'x-origin': 'https://music.youtube.com',
      },
      {
        ...body,
        context: { client: { clientName: 'WEB_REMIX', clientVersion: `1.${d}.01.00`, hl: 'en', gl: 'US' }, user: {} },
      },
    );
  }
  /** Authenticated InnerTube on www.youtube.com (TVHTML5): the one client that accepts a TV OAuth token. */
  async tv(endpoint: string, body: object): Promise<J> {
    if (!this.token) throw new AuthError('no token');
    return this.post(
      `${TV}${endpoint}?prettyPrint=false`,
      { 'content-type': 'application/json', 'user-agent': TV_UA, authorization: `Bearer ${this.token}` },
      {
        ...body,
        context: { client: { clientName: 'TVHTML5', clientVersion: '7.20250120.19.00', hl: 'en', gl: 'US' }, user: {} },
      },
    );
  }
  /** YouTube Data API v3 (quota: list = 1 unit, insert = 50). */
  async data(method: 'GET' | 'POST', path: string, body?: object): Promise<J> {
    if (!this.token) throw new AuthError('no token');
    let r: Response;
    try {
      r = await fetch(`${DATA}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ThrottleError(-1, String(e).slice(0, 120));
    }
    const j: J = await r.json().catch(() => ({}));
    if (r.ok) return j;
    const reason: string = j?.error?.errors?.[0]?.reason ?? '';
    if (r.status === 401) throw new AuthError();
    if (r.status === 403 && /quotaExceeded|dailyLimit/i.test(reason))
      throw new ThrottleError(403, reason, msUntilQuotaReset()); // project-wide daily quota
    if (r.status === 403 && /rateLimit/i.test(reason)) throw new ThrottleError(403, reason);
    if (r.status === 403) throw new AuthError(reason);
    if (r.status === 429 || r.status >= 500) throw new ThrottleError(r.status, reason);
    throw new Error(
      `data api ${path.split('?')[0]}: ${r.status} ${reason || String(j?.error?.message ?? '').slice(0, 120)}`,
    );
  }

  // ---- search (anonymous)
  private async search(q: string, params: string): Promise<J[]> {
    return shelves(await this.music('search', { query: q, params }));
  }
  async searchSongs(q: string, filter: 'songs' | 'videos' = 'songs'): Promise<SearchSong[]> {
    return (await this.search(q, SEARCH_PARAMS[filter])).map(parseSong).filter((x): x is SearchSong => !!x);
  }
  async searchAlbums(q: string): Promise<SearchAlbum[]> {
    return (await this.search(q, SEARCH_PARAMS.albums)).map(parseAlbum).filter((x): x is SearchAlbum => !!x);
  }
  async searchArtists(q: string): Promise<SearchArtist[]> {
    return (await this.search(q, SEARCH_PARAMS.artists)).map(parseArtist).filter((x): x is SearchArtist => !!x);
  }
  /** Only when a search result carried no playlist id: the web client's browse page names it (the Android one does not). */
  async albumPlaylistId(browseId: string): Promise<string | null> {
    const j = await this.musicAs('web', 'browse', { browseId });
    return String(j?.microformat?.microformatDataRenderer?.urlCanonical ?? '').match(/list=([\w-]+)/)?.[1] ?? null;
  }

  // ---- writes
  async createPlaylist(
    title: string,
    description: string,
    privacy: 'PRIVATE' | 'PUBLIC' | 'UNLISTED',
  ): Promise<string> {
    const j = await this.data('POST', 'playlists?part=snippet,status', {
      snippet: { title: title.slice(0, 150) || 'Untitled', description: description.slice(0, 1000) },
      status: { privacyStatus: privacy.toLowerCase() },
    });
    if (typeof j?.id !== 'string') throw new Error('playlists.insert returned no id');
    return j.id;
  }
  async addPlaylistItems(playlistId: string, videoIds: string[]): Promise<void> {
    const j = await this.tv('browse/edit_playlist', {
      playlistId,
      actions: videoIds.map((v) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v })),
    });
    if (j?.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(`edit_playlist: ${j.status}`);
  }
  like(videoId: string) {
    return this.tv('like/like', { target: { videoId } });
  }
  /** Saving an album = liking its `OLAK5uy_` playlist. */
  likePlaylist(playlistId: string) {
    return this.tv('like/like', { target: { playlistId } });
  }
  subscribe(channelId: string) {
    return this.tv('subscription/subscribe', { channelIds: [channelId] });
  }

  // ---- read-backs (D15)
  /** All videoIds in a playlist (Data API, 50 per page, 1 unit each). `LL` = liked videos. Reads throttle and expire like writes do. */
  async playlistVideoIds(playlistId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    for (let pageToken = '', guard = 0; guard < 1000; guard++) {
      // 1000 pages ≫ MAX_TRACKS
      const j = await this.data(
        'GET',
        `playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      );
      for (const it of j?.items ?? []) {
        const v = it?.contentDetails?.videoId;
        if (typeof v === 'string') ids.add(v);
      }
      pageToken = typeof j?.nextPageToken === 'string' ? j.nextPageToken : '';
      if (!pageToken) break;
    }
    return ids;
  }
  likedVideoIds() {
    return this.playlistVideoIds('LL');
  }
}
