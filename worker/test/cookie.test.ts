// worker/test/cookie.test.ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { readSession, writeSession, clearSession } from '../src/cookie';
import type { Env } from '../src/env';

const app = new Hono<{ Bindings: Env }>()
  .post('/set', async c => { await writeSession(c, c.env, { google: { access: 'a', refresh: 'r', expiresAt: 1 } }); return c.text('ok'); })
  .get('/get', async c => c.json(await readSession(c, c.env)))
  .post('/clear', c => { clearSession(c); return c.text('ok'); });

describe('session cookie', () => {
  it('roundtrips through an HttpOnly cookie', async () => {
    const set = await app.request('http://127.0.0.1/set', { method: 'POST' }, env);
    const cookie = set.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^sl_s=/); expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/SameSite=Lax/); expect(cookie).not.toMatch(/Secure/);
    const got = await app.request('http://127.0.0.1/get', { headers: { cookie: cookie.split(';')[0]! } }, env);
    expect(await got.json()).toEqual({ google: { access: 'a', refresh: 'r', expiresAt: 1 } });
  });
  it('uses __Host- prefix and Secure over https', async () => {
    const set = await app.request('https://sideload.app/set', { method: 'POST' }, env);
    expect(set.headers.get('set-cookie')).toMatch(/^__Host-sl_s=.*Secure/);
  });
  it('returns null for garbage', async () => {
    const got = await app.request('http://127.0.0.1/get', { headers: { cookie: 'sl_s=nope' } }, env);
    expect(await got.json()).toBeNull();
  });
  it('clear emits an expired cookie', async () => {
    const r = await app.request('http://127.0.0.1/clear', { method: 'POST' }, env);
    expect(r.headers.get('set-cookie')).toMatch(/^sl_s=;.*Max-Age=0/);
  });
});
