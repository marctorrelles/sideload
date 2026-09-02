import type { Env } from '../src/env';
declare module 'cloudflare:test' { interface ProvidedEnv extends Env {} }
declare global { namespace Cloudflare { interface Env extends import('../src/env').Env {} } }
export {};
