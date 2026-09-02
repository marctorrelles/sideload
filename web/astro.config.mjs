// web/astro.config.mjs
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://sideload.marctorrelles.com',
  output: 'static',
  trailingSlash: 'never',
  // connect.astro → /connect.html, t/index.astro → /t/index.html (served at /t/ without a redirect)
  build: { format: 'preserve', inlineStylesheets: 'never' },
  integrations: [preact(), sitemap({ filter: p => !/\/(connect|select|t|404)$/.test(p) && !p.endsWith('/t/') })],
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: https://i.scdn.co https://mosaic.scdn.co https://*.spotifycdn.com https://lh3.googleusercontent.com https://yt3.ggpht.com",
        "connect-src 'self'",
        "font-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ],
    },
  },
  vite: {
    server: { proxy: { '/api': 'http://127.0.0.1:8787', '/auth': 'http://127.0.0.1:8787' } },
    resolve: { alias: { '@shared': new URL('../shared', import.meta.url).pathname } },
  },
});
