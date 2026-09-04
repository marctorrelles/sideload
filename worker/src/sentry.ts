// worker/src/sentry.ts: Sentry options shared by the Worker and the Durable Objects. Without SENTRY_DSN (forks, tests,
// local dev) the SDK initialises and sends nothing. Errors only: no tracing, no PII, never the cookies (session tokens
// live there) or request headers.
import type { CloudflareOptions } from '@sentry/cloudflare';
import type { Env } from './env';

export const sentryOptions = (env: Env): CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request) {
      delete event.request.cookies;
      delete event.request.headers;
    }
    return event;
  },
});
