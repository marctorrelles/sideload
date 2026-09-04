// worker/test/routes-validate.test.ts: the input caps behind POST /api/jobs
import { describe, it, expect } from 'vitest';
import { validateSelection } from '../src/routes-validate';
import { HttpError } from '../src/http';
const pl = (extra: object = {}) => ({
  id: 'P'.repeat(22),
  name: 'x',
  description: null,
  isPublic: false,
  trackCount: 1,
  ...extra,
});
const status = (b: unknown) => {
  try {
    validateSelection(b);
    return 200;
  } catch (e) {
    return (e as HttpError).status;
  }
};
describe('validateSelection', () => {
  it('accepts a normal selection and rejects oversized or malformed ones', () => {
    expect(status({ playlists: [pl()] })).toBe(200);
    expect(status({ liked: true })).toBe(200);
    expect(status({ playlists: Array.from({ length: 501 }, () => pl()) })).toBe(413);
    expect(status({ playlists: [pl({ trackCount: -1 })] })).toBe(400);
    expect(status({ playlists: [pl({ name: 'x'.repeat(201) })] })).toBe(400);
    expect(status({ playlists: [pl({ id: 'short' })] })).toBe(400);
    expect(status({})).toBe(400); // empty selection
    expect(status(null)).toBe(400);
  });
});
