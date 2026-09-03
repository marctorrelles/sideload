// worker/test/telemetry.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { fetchMock } from './fetch-mock';
import { track } from '../src/telemetry';

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('telemetry', () => {
  it('sends nothing without a token', async () => {
    await expect(track({}, 'job_done', 'tid', { moved: 3 })).resolves.toBeUndefined(); // net is disabled: a fetch would throw
  });
  it('posts one event with the token, the distinct id and the props, ip=0', async () => {
    let sent: any;
    fetchMock.get('https://api.mixpanel.com').intercept({ path: '/track?ip=0', method: 'POST' }).reply(200, ({ body }) => { sent = JSON.parse(body!); return '1'; });
    await track({ MIXPANEL_TOKEN: 'tok' }, 'job_created', 'abc', { playlists: 2, liked: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].event).toBe('job_created');
    expect(sent[0].properties).toMatchObject({ token: 'tok', distinct_id: 'abc', playlists: 2, liked: true });
    expect(sent[0].properties.$insert_id).toBeTruthy();
  });
  it('honours MIXPANEL_API and never throws on a failed post', async () => {
    fetchMock.get('https://api-eu.mixpanel.com').intercept({ path: '/track?ip=0', method: 'POST' }).reply(500, 'nope');
    await expect(track({ MIXPANEL_TOKEN: 'tok', MIXPANEL_API: 'https://api-eu.mixpanel.com' }, 'job_failed', undefined, { failure: 'timeout' })).resolves.toBeUndefined();
  });
});
