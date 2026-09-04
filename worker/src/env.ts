// worker/src/env.ts
import type { JobDO } from './job-do';
import type { StatsDO } from './stats-do';
export interface RateLimit {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}
export interface Env {
  ASSETS: Fetcher;
  JOB: DurableObjectNamespace<JobDO>;
  STATS: DurableObjectNamespace<StatsDO>;
  MATCH_CACHE: KVNamespace;
  RL_AUTH?: RateLimit;
  RL_JOB_CREATE?: RateLimit;
  RL_READ?: RateLimit;
  RL_SEARCH?: RateLimit; // optional: absent in vitest
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COOKIE_SECRET: string;
  TOKEN_SECRET: string;
  PUBLIC_ORIGIN: string;
  REVIEW_CODE?: string; // optional: a 32-hex "Client ID" that connects the built-in demo library (spotify-demo.ts) instead of Spotify
  SENTRY_DSN?: string; // optional: error reports go nowhere without it
  MIXPANEL_TOKEN?: string;
  MIXPANEL_API?: string; // optional: usage events go nowhere without the token; API defaults to api.mixpanel.com (EU projects: api-eu.mixpanel.com)
}
