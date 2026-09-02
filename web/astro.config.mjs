// web/astro.config.mjs
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Astro's CSP hashes miss the <style> blocks it emits for transition:name / transition:animate scopes, so hash every
// inline <style> in the built HTML and add it to the page's own meta policy.
const cspStyleHashes = () => ({
  name: 'csp-style-hashes',
  hooks: {
    'astro:build:done': ({ dir }) => {
      const root = dir.pathname;
      for (const f of readdirSync(root, { recursive: true }).filter(f => String(f).endsWith('.html'))) {
        const path = `${root}/${f}`; const html = readFileSync(path, 'utf8');
        const hashes = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
        if (hashes.length) writeFileSync(path, html.replace(/style-src 'self'/, `style-src 'self' ${hashes.join(' ')}`));
      }
    },
  },
});

export default defineConfig({
  site: 'https://sideload.marctorrelles.com',
  output: 'static',
  trailingSlash: 'never',
  // connect.astro → /connect.html, t/index.astro → /t/index.html (served at /t/ without a redirect)
  build: { format: 'preserve', inlineStylesheets: 'never' },
  integrations: [preact(), cspStyleHashes(), sitemap({ filter: p => !/\/(connect|select|t|404)$/.test(p) && !p.endsWith('/t/') })],
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
    // dev only: the Worker serves /t/index.html for /t/<id> in production
    plugins: [{ name: 'transfer-shell', configureServer(s) { s.middlewares.use((req, _res, next) => { if (/^\/t\/[a-z0-9]{26}$/.test(req.url ?? '')) req.url = '/t'; next(); }); } }],
    server: { proxy: { '/api': 'http://127.0.0.1:8787', '/auth': 'http://127.0.0.1:8787' } },
    resolve: { alias: { '@shared': new URL('../shared', import.meta.url).pathname } },
  },
});
