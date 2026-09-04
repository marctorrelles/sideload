// web/src/lib/api.ts: the worker's JSON API. Same-origin; cookies carry the session.
import type {
  SessionView,
  Library,
  Selection,
  JobView,
  ReviewItemView,
  ReviewAction,
  ManualSearchResult,
} from '@shared/types';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    credentials: 'same-origin',
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(r.status, j.error ?? 'http', j.message ?? `Request failed (${r.status})`);
  }
  return r.json() as Promise<T>;
}
const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const api = {
  session: () => req<SessionView>('/api/session'),
  spotifyStart: (clientId: string) => post<{ url: string }>('/auth/spotify/start', { clientId }),
  spotifyLogout: () => post('/auth/spotify/logout'),
  googleStart: () =>
    post<{ userCode: string; verificationUrl: string; interval: number; expiresIn: number }>('/auth/google/start'),
  googlePoll: () => post<{ status: 'pending' | 'slow_down' | 'connected' | 'denied' | 'expired' }>('/auth/google/poll'),
  googleLogout: () => post('/auth/google/logout'),
  library: () => req<Library>('/api/library'),
  createJob: (s: Selection) => post<{ id: string }>('/api/jobs', s),
  job: (id: string) => req<JobView>(`/api/jobs/${id}`),
  review: (id: string, offset: number) => req<ReviewItemView[]>(`/api/jobs/${id}/review?offset=${offset}`),
  pause: (id: string) => post(`/api/jobs/${id}/pause`),
  resume: (id: string) => post(`/api/jobs/${id}/resume`),
  disconnect: (id: string) => post(`/api/jobs/${id}/disconnect`),
  resolve: (id: string, trackId: number, a: ReviewAction) => post(`/api/jobs/${id}/review/${trackId}`, a),
  search: (id: string, q: string) => req<ManualSearchResult[]>(`/api/jobs/${id}/search?q=${encodeURIComponent(q)}`),
};
