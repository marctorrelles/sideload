// shared/types.ts — DTOs shared by worker and web. No runtime code.
export type Provider = 'ytmusic';
export type ItemKind = 'liked' | 'playlist' | 'album' | 'artist';
export type ItemStatus = 'queued' | 'fetching' | 'matching' | 'writing' | 'verifying' | 'done' | 'failed';
export type TrackStatus = 'pending' | 'matched' | 'moved' | 'review' | 'skipped';
export type ReviewReason = 'no_match' | 'low_confidence' | 'unavailable' | 'local_file' | 'duplicate_match' | 'write_failed' | 'not_accessible';
export type JobStatus = 'running' | 'paused' | 'done' | 'failed';
export type JobFailure = 'auth_expired' | 'provider_error' | 'too_large' | 'timeout';

export interface SessionView {
  spotify: null | { displayName: string; email: string | null; clientId: string; counts: { playlists: number; liked: number } };
  destination: null | { provider: Provider };
}

export interface LibraryPlaylist { id: string; name: string; description: string | null; owner: string; ownedByUser: boolean; isAlgorithmic: boolean; collaborative: boolean; isPublic: boolean | null; trackCount: number | null; image: string | null }
export interface LibraryAlbum { id: string; name: string; artist: string; trackCount: number; image: string | null }
export interface LibraryArtist { id: string; name: string; image: string | null }
export interface Library { likedCount: number; playlists: LibraryPlaylist[]; albums: LibraryAlbum[]; artists: LibraryArtist[] }

/** What the client sends to POST /api/jobs. Names travel with ids so the job never re-lists the library. */
export interface Selection {
  liked: boolean; likedCount: number;
  playlists: { id: string; name: string; description: string | null; isPublic: boolean; trackCount: number }[];
  albums: { id: string; name: string; artist: string }[];
  artists: { id: string; name: string }[];
}

export interface JobItemView { id: string; kind: ItemKind; name: string; total: number; moved: number; review: number; status: ItemStatus; ytId: string | null }
export interface ReviewItemView { id: number; kind: ItemKind; title: string; artist: string; itemName: string; reason: ReviewReason; suggestion: null | { videoId: string; title: string; artists: string }; collidesWith: string | null; actionable: boolean }
export interface JobView {
  id: string; status: JobStatus; failure: JobFailure | null;
  totals: { tracks: number; moved: number; review: number; skipped: number; collapsed: number; writeFailed: number };
  items: JobItemView[];
  review: ReviewItemView[]; reviewTotal: number;
  startedAt: number; finishedAt: number | null;
  ratePerMin: number | null; etaSeconds: number | null; throttledUntil: number | null;
  ytConnected: boolean; searches: number; cacheHits: number;
}
export type ReviewAction = { action: 'closest' } | { action: 'manual'; videoId: string } | { action: 'skip' };
export interface ManualSearchResult { videoId: string; title: string; artists: string; album: string | null; durationSec: number | null }
export interface StatsView { tracksMoved: number; jobs: number; matchRate: number | null; medianMinutes: number | null }
