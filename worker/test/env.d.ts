// `env` from cloudflare:test is typed as Cloudflare.Env; merge our bindings into it.
import type { Env as WorkerEnv } from '../src/env';
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
export {};
