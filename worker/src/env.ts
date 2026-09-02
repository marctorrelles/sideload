// worker/src/env.ts
import type { JobDO } from './job-do';
import type { StatsDO } from './stats-do';
export interface RateLimit { limit(o: { key: string }): Promise<{ success: boolean }> }
export interface Env {
  ASSETS: Fetcher;
  JOB: DurableObjectNamespace<JobDO>;
  STATS: DurableObjectNamespace<StatsDO>;
  MATCH_CACHE: KVNamespace;
  RL_AUTH?: RateLimit; RL_JOB_CREATE?: RateLimit; RL_READ?: RateLimit; RL_SEARCH?: RateLimit; // optional: absent in vitest
  GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string;
  COOKIE_SECRET: string; TOKEN_SECRET: string;
  PUBLIC_ORIGIN: string;
}
