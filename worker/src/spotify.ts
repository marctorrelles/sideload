// worker/src/spotify.ts
export const SPOTIFY_SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative user-follow-read user-read-email';
export const CLIENT_ID_RE = /^[a-f0-9]{32}$/;
const AUTH = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(public status: number, public code: string, message?: string, public retryAfter = 0) { super(message ?? code); }
}

export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  return `${AUTH}/authorize?${new URLSearchParams({ client_id: p.clientId, response_type: 'code', redirect_uri: p.redirectUri, scope: SPOTIFY_SCOPES, code_challenge_method: 'S256', code_challenge: p.challenge, state: p.state })}`;
}
interface TokenResp { access_token: string; refresh_token?: string; expires_in: number; error?: string; error_description?: string }
async function tokenRequest(body: Record<string, string>): Promise<TokenResp> {
  const r = await fetch(`${AUTH}/api/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(30_000) });
  const j = (await r.json()) as TokenResp;
  if (!r.ok || !j.access_token) throw new SpotifyError(r.status, j.error ?? 'token_error', j.error_description);
  return j;
}
export const exchangeCode = (p: { clientId: string; code: string; verifier: string; redirectUri: string }) =>
  tokenRequest({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: p.verifier });
export const refreshToken = (clientId: string, refresh: string) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId });

export interface Tokens { access: string; refresh: string; expiresAt: number; clientId: string }
export interface SpotifyTrack { id: string | null; name: string; artists: string[]; album: string; durationMs: number; isLocal: boolean; isEpisode: boolean; addedAt: string | null }
export interface Page<T> { items: T[]; total: number; next: string | null }
export interface RawPlaylist { id: string; name: string; description: string | null; public: boolean | null; collaborative: boolean; owner: { id: string; display_name: string | null }; images: { url: string }[] | null; items?: { total: number } | null; tracks?: { total: number } | null }
interface RawItem { id: string | null; name: string; type: 'track' | 'episode'; duration_ms: number; artists?: { name: string }[]; album?: { name: string }; is_local?: boolean }
export interface RawEntry { added_at: string | null; is_local: boolean; item?: RawItem | null; track?: RawItem | null }

export function toTrack(e: RawEntry): SpotifyTrack | null {
  const it = e.item ?? e.track;
  if (!it || !it.name) return null; // deleted / region-blocked entries come back as null
  return { id: it.id, name: it.name, artists: (it.artists ?? []).map(a => a.name), album: it.album?.name ?? '', durationMs: it.duration_ms ?? 0, isLocal: !!e.is_local || !!it.is_local, isEpisode: it.type === 'episode' || !it.artists, addedAt: e.added_at };
}

export class Spotify {
  constructor(private t: Tokens, private onRefresh: (t: Tokens) => Promise<void>) {}
  private async get<T>(path: string): Promise<T> {
    if (this.t.expiresAt - Date.now() < 120_000) {
      const r = await refreshToken(this.t.clientId, this.t.refresh);
      this.t = { ...this.t, access: r.access_token, refresh: r.refresh_token ?? this.t.refresh, expiresAt: Date.now() + r.expires_in * 1000 };
      await this.onRefresh(this.t);
    }
    let r: Response;
    try { r = await fetch(path.startsWith('http') ? path : `${API}${path}`, { headers: { authorization: `Bearer ${this.t.access}` }, signal: AbortSignal.timeout(30_000) }); }
    catch { throw new SpotifyError(429, 'timeout', 'Spotify did not answer in 30 s', 10); } // D17: a hang is a retryable failure
    if (r.status === 429) throw new SpotifyError(429, 'rate_limited', 'Spotify rate limit', Number(r.headers.get('retry-after') ?? 5));
    if (r.status === 401) throw new SpotifyError(401, 'auth_expired');
    if (!r.ok) throw new SpotifyError(r.status, 'http_error', (await r.text()).slice(0, 300));
    return r.json() as Promise<T>;
  }
  me() { return this.get<{ id: string; email?: string; display_name: string | null }>('/me'); }
  playlists(url = '/me/playlists?limit=50') { return this.get<Page<RawPlaylist>>(url); }
  playlistItems(id: string, offset: number) { return this.get<Page<RawEntry>>(`/playlists/${id}/items?limit=50&offset=${offset}&additional_types=track,episode`); }
  savedTracks(offset: number) { return this.get<Page<RawEntry>>(`/me/tracks?limit=50&offset=${offset}`); }
  savedAlbums(url = '/me/albums?limit=50') { return this.get<Page<{ album: { id: string; name: string; artists: { name: string }[]; total_tracks: number; images: { url: string }[] } }>>(url); }
  followedArtists(after?: string) { return this.get<{ artists: { items: { id: string; name: string; images: { url: string }[] }[]; cursors: { after: string | null }; total: number } }>(`/me/following?type=artist&limit=50${after ? `&after=${after}` : ''}`); }
}
