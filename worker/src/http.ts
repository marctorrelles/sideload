// worker/src/http.ts
import type { Context, MiddlewareHandler } from 'hono';
import type { Env, RateLimit } from './env';

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}
type App = { Bindings: Env };

/** Applied to every response, including static assets (immutable headers → copy) and error responses (called again from app.onError). */
export function withSecurityHeaders(res: Response, path: string): Response {
  const out = new Response(res.body, res);
  out.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  out.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()');
  out.headers.set('Content-Security-Policy', "frame-ancestors 'none'"); // page-level CSP (script/style hashes) comes from Astro's <meta>
  if (path.startsWith('/api/') && !out.headers.has('Cache-Control')) out.headers.set('Cache-Control', 'no-store');
  return out;
}
export const securityHeaders: MiddlewareHandler<App> = async (c, next) => {
  await next(); // if a handler throws, app.onError builds the response and applies withSecurityHeaders itself
  c.res = withSecurityHeaders(c.res, c.req.path);
};

/** Blocks cross-site POSTs even though cookies are SameSite=Lax. Belt and braces. */
export const sameOrigin: MiddlewareHandler<App> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const site = c.req.header('Sec-Fetch-Site');
    const origin = c.req.header('Origin');
    const ok = site === 'same-origin' || site === 'none' || origin === new URL(c.req.url).origin;
    if (!ok) throw new HttpError(403, 'cross_site');
  }
  await next();
};

export const rateLimit =
  (
    binding: 'RL_AUTH' | 'RL_JOB_CREATE' | 'RL_READ' | 'RL_SEARCH',
    keyFn?: (c: Context<App>) => string,
  ): MiddlewareHandler<App> =>
  async (c, next) => {
    const rl = c.env[binding] as RateLimit | undefined;
    if (rl) {
      // binding absent → no limit (recent wrangler/miniflare do provide working local limiters in tests; keep test call counts under the configured limits)
      const key = keyFn ? keyFn(c) : (c.req.header('CF-Connecting-IP') ?? 'local');
      const { success } = await rl.limit({ key });
      if (!success) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
    }
    await next();
  };
