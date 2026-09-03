// worker/test/google.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { fetchMock } from './fetch-mock';
import { deviceCode, pollDevice, refreshGoogle, channelInfo } from '../src/google';
beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
const g = () => fetchMock.get('https://oauth2.googleapis.com');

describe('google device flow', () => {
  it('requests a device code with the youtube scope', async () => {
    g().intercept({ path: '/device/code', method: 'POST', body: b => String(b).includes('auth%2Fyoutube') }).reply(200, { device_code: 'd', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 });
    expect(await deviceCode('cid')).toEqual({ deviceCode: 'd', userCode: 'ABCD-EFGH', verificationUrl: 'https://www.google.com/device', expiresIn: 1800, interval: 5 });
  });
  it('maps poll states', async () => {
    g().intercept({ path: '/token', method: 'POST' }).reply(428, { error: 'authorization_pending' });
    expect(await pollDevice('cid', 's', 'd')).toEqual({ status: 'pending' });
    g().intercept({ path: '/token', method: 'POST' }).reply(200, { access_token: 'a', refresh_token: 'r', expires_in: 3599 });
    const ok = await pollDevice('cid', 's', 'd');
    expect(ok.status).toBe('ok'); if (ok.status === 'ok') expect(ok.refresh).toBe('r');
    g().intercept({ path: '/token', method: 'POST' }).reply(403, { error: 'access_denied' });
    expect(await pollDevice('cid', 's', 'd')).toEqual({ status: 'denied' });
  });
  it('refreshes', async () => {
    g().intercept({ path: '/token', method: 'POST', body: b => String(b).includes('grant_type=refresh_token') }).reply(200, { access_token: 'a2', expires_in: 3599 });
    expect((await refreshGoogle('cid', 's', 'r')).access).toBe('a2');
  });
  it('channelInfo is best-effort: null on any failure', async () => {
    fetchMock.get('https://www.googleapis.com').intercept({ path: '/youtube/v3/channels?part=snippet&mine=true' }).reply(403, {});
    expect(await channelInfo('t')).toBeNull();
  });
});
