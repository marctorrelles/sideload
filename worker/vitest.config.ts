// worker/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: '../wrangler.jsonc' },
      miniflare: {
        kvNamespaces: ['MATCH_CACHE'],
        bindings: {
          GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
          COOKIE_SECRET: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // 32 zero bytes, base64url, tests only
          TOKEN_SECRET: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          PUBLIC_ORIGIN: 'http://127.0.0.1:4321',
          REVIEW_CODE: 'deadbeef'.repeat(4),
        },
      },
    }),
  ],
});
