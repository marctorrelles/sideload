// worker/src/cookie.ts
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { seal, open } from './crypto';
import type { Env } from './env';

export interface SpotifySession {
  clientId: string;
  access: string;
  refresh: string;
  expiresAt: number;
  userId: string;
  email: string | null;
  displayName: string;
  counts: { playlists: number; liked: number };
}
export interface GoogleSession {
  access: string;
  refresh: string;
  expiresAt: number;
  account?: { title: string; handle: string | null } | null;
}
export interface Session {
  spotify?: SpotifySession;
  google?: GoogleSession;
  tid?: string; /* telemetry id: random, per session, not an account id */
}
export interface OAuthTransient {
  spotify?: { state: string; verifier: string; clientId: string };
  google?: { deviceCode: string; expiresAt: number };
}

const SESSION = 'sl_s',
  TRANSIENT = 'sl_o';
const SESSION_TTL = 3600,
  TRANSIENT_TTL = 900;

const https = (c: Context) => new URL(c.req.url).protocol === 'https:';
const name = (c: Context, base: string) => (https(c) ? `__Host-${base}` : base);

async function read<T>(c: Context, env: Env, base: string): Promise<T | null> {
  const raw = getCookie(c, name(c, base));
  if (!raw) return null;
  const v = await open<{ exp: number; d: T }>(env.COOKIE_SECRET, raw);
  return v && v.exp > Date.now() ? v.d : null;
}
async function write<T>(c: Context, env: Env, base: string, ttl: number, d: T): Promise<void> {
  const value = await seal(env.COOKIE_SECRET, { exp: Date.now() + ttl * 1000, d });
  if (value.length > 3800) throw new Error('cookie too large'); // ponytail: sessions are ~1.5 KB; fail loudly, not silently at the browser
  setCookie(c, name(c, base), value, { httpOnly: true, secure: https(c), sameSite: 'Lax', path: '/', maxAge: ttl });
}
export const readSession = (c: Context, env: Env) => read<Session>(c, env, SESSION);
export const writeSession = (c: Context, env: Env, s: Session) => write(c, env, SESSION, SESSION_TTL, s);
export const clearSession = (c: Context) => deleteCookie(c, name(c, SESSION), { path: '/', secure: https(c) });
export const readTransient = (c: Context, env: Env) => read<OAuthTransient>(c, env, TRANSIENT);
export const writeTransient = (c: Context, env: Env, t: OAuthTransient) => write(c, env, TRANSIENT, TRANSIENT_TTL, t);
export const clearTransient = (c: Context) => deleteCookie(c, name(c, TRANSIENT), { path: '/', secure: https(c) });
