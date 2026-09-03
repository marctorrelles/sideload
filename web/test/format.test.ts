import { it, expect } from 'vitest';
import { compact, eta, preEstimate, duration, pct } from '../src/lib/format';
it('formats', () => {
  expect(compact(1_234_567)).toBe('1.2M'); expect(compact(5288)).toBe('5,288'); expect(compact(12_400)).toBe('12k');
  expect(eta(30)).toBe('under a minute left'); expect(eta(150)).toBe('about 3 minutes left'); expect(eta(4000)).toBe('about 1 h 7 min left'); expect(eta(null)).toBe('estimating…');
  expect(preEstimate(5288)).toBe('~2 h'); expect(preEstimate(300)).toBe('~7 min');
  expect(duration(3_000)).toBe('3 s'); expect(duration(372_000)).toBe('6 min 12 s'); expect(duration(3_700_000)).toBe('1 h 1 min');
  expect(pct(3304, 5288)).toBe(62); expect(pct(1, 0)).toBe(0);
});
