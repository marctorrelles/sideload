// worker/test/telemetry.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as Sentry from '@sentry/cloudflare';
import { track, pageView } from '../src/telemetry';

vi.mock('@sentry/cloudflare', () => ({ setUser: vi.fn(), logger: { info: vi.fn() } }));

describe('telemetry', () => {
  it('logs the event as a crashyard action under the session id, without empty props', () => {
    track('job_created', 'abc', { playlists: 2, liked: true, albums: undefined, artists: null });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'abc' });
    expect(Sentry.logger.info).toHaveBeenCalledWith('job_created', {
      'crashyard.action': true,
      playlists: 2,
      liked: true,
    });
  });
  it('counts a page a browser opens, with the referring host and no query', () => {
    const open = (url: string, headers: Record<string, string>, status = 200) =>
      pageView(new Request(url, { headers }), new Response('', { status }));
    const doc = { 'sec-fetch-dest': 'document' };
    expect(open('https://s.test/faq?q=x', { ...doc, referer: 'https://news.ycombinator.com/' })).toEqual({
      path: '/faq',
      referrer: 'news.ycombinator.com',
    });
    expect(open('https://s.test/connect', { ...doc, referer: 'https://s.test/' })).toEqual({
      path: '/connect',
      referrer: undefined,
    });
    expect(open('https://s.test/app.js', { 'sec-fetch-dest': 'script' })).toBeUndefined();
    expect(open('https://s.test/nope', doc, 404)).toBeUndefined();
  });
});
