// worker/test/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { seal, open, randomId, ID_RE, pkceVerifier, pkceChallenge, b64url, unb64url } from '../src/crypto';
const SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('crypto', () => {
  it('seals and opens', async () => {
    const t = await seal(SECRET, { a: 1, s: 'ü' });
    expect(await open(SECRET, t)).toEqual({ a: 1, s: 'ü' });
  });
  it('rejects tampering and wrong key', async () => {
    const t = await seal(SECRET, { a: 1 });
    expect(await open(SECRET, t.slice(0, -2) + 'zz')).toBeNull();
    expect(await open('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', t)).toBeNull();
  });
  it('randomId is 26 chars crockford and unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, randomId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(ID_RE);
  });
  it('b64url roundtrip', () => {
    const b = new Uint8Array([0, 255, 1, 254, 7]);
    expect(unb64url(b64url(b))).toEqual(b);
  });
  it('pkce challenge is S256 of verifier', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    ); // RFC 7636 appendix B
  });
  it('pkceVerifier is 64 url-safe chars', () => {
    expect(pkceVerifier()).toMatch(/^[\w-]{64}$/);
  });
});
