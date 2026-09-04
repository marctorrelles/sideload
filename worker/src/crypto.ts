// worker/src/crypto.ts
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0));
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function key(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    const raw = unb64url(secret);
    if (raw.length !== 32) throw new Error('secret must be 32 bytes, base64url');
    k = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keyCache.set(secret, k);
  }
  return k;
}

/** AES-256-GCM. Output: base64url(iv ‖ ciphertext ‖ tag). */
export async function seal(secret: string, data: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), enc.encode(JSON.stringify(data))),
  );
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64url(out);
}
export async function open<T>(secret: string, token: string): Promise<T | null> {
  try {
    const buf = unb64url(token);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, await key(secret), buf.slice(12));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase
export const ID_RE = /^[0-9abcdefghjkmnpqrstvwxyz]{26}$/;
/** 128 random bits → 26 chars. This IS the job's bearer secret. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bits = 0,
    value = 0,
    out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function pkceVerifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(48)));
}
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
}
