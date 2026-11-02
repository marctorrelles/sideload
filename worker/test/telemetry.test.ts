// worker/test/telemetry.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as Sentry from '@sentry/cloudflare';
import { track } from '../src/telemetry';

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
});
