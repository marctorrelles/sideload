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
const sid = (i: number) => String(i).padStart(22, 'P'); // distinct Spotify ids: duplicates collapse
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
    expect(status({ playlists: Array.from({ length: 180 }, (_, i) => pl({ id: sid(i) })) })).toBe(200); // the Data API quota ceiling
    expect(status({ playlists: Array.from({ length: 181 }, (_, i) => pl({ id: sid(i) })) })).toBe(413);
    expect(status({ albums: Array.from({ length: 2001 }, (_, i) => ({ id: sid(i), name: 'a', artist: 'b' })) })).toBe(
      413,
    );
    expect(status({ playlists: [pl({ trackCount: -1 })] })).toBe(400);
    expect(status({ playlists: [pl({ name: 'x'.repeat(201) })] })).toBe(400);
    expect(status({ playlists: [pl({ id: 'short' })] })).toBe(400);
    expect(status({})).toBe(400); // empty selection
    expect(status(null)).toBe(400);
  });
  it('drops duplicate ids (Spotify paging can list one twice; each id is a JobDO item key)', () => {
    const s = validateSelection({
      playlists: [pl(), pl()],
      albums: [
        { id: sid(1), name: 'a' },
        { id: sid(1), name: 'a' },
      ],
    });
    expect(s.playlists).toHaveLength(1);
    expect(s.albums).toHaveLength(1);
  });
});
