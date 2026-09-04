// worker/test/stats-do.test.ts
import { it, expect } from 'vitest';
import { env } from 'cloudflare:test';
it('accumulates and reports median minutes over sizeable runs', async () => {
  const s = env.STATS.get(env.STATS.idFromName('test-' + Math.random()));
  await s.add({ moved: 90, total: 100, seconds: 600 });
  await s.add({ moved: 5, total: 5, seconds: 10 }); // tiny run: excluded from median
  await s.add({ moved: 1000, total: 1000, seconds: 1800 });
  expect(await s.get()).toEqual({ tracksMoved: 1095, jobs: 3, matchRate: 1095 / 1105, medianMinutes: 20 });
});
