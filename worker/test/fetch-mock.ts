// worker/test/fetch-mock.ts — undici-MockAgent-style shim over globalThis.fetch.
// @cloudflare/vitest-pool-workers 0.22 dropped `fetchMock` from `cloudflare:test`; tests and the main worker share one
// isolate, so a stubbed global `fetch` reaches Durable Objects and SELF.fetch handlers alike.
import { vi } from 'vitest';

type Matcher = string | RegExp | ((v: string) => boolean);
export interface InterceptOptions { path: Matcher; method?: Matcher; headers?: Record<string, Matcher>; body?: Matcher }
type Data = object | string;
export interface CallbackOptions { path: string; origin: string; method: string; body?: string; headers: Record<string, string> }
type DataFn = (o: CallbackOptions) => Data;
interface Interceptor { origin: string; opts: InterceptOptions; status: number; data: Data | DataFn; headers: Record<string, string>; times: number; delayMs: number }

const match = (m: Matcher | undefined, v: string): boolean => m === undefined || (typeof m === 'string' ? m === v : m instanceof RegExp ? m.test(v) : m(v));

class MockScope {
  constructor(private i: Interceptor) {}
  times(n: number) { this.i.times = n; return this; }
  persist() { this.i.times = Infinity; return this; }
  delay(ms: number) { this.i.delayMs = ms; return this; }
}
class MockInterceptor {
  constructor(private origin: string, private opts: InterceptOptions, private list: Interceptor[]) {}
  reply(status: number, data: Data | DataFn = '', o: { headers?: Record<string, string> } = {}) {
    const i: Interceptor = { origin: this.origin, opts: this.opts, status, data, headers: o.headers ?? {}, times: 1, delayMs: 0 };
    this.list.push(i);
    return new MockScope(i);
  }
}
class Interceptable {
  constructor(private origin: string, private list: Interceptor[]) {}
  intercept(opts: InterceptOptions) { return new MockInterceptor(this.origin, opts, this.list); }
}

class FetchMock {
  private list: Interceptor[] = [];
  private real = globalThis.fetch;
  private netConnect = true;
  activate() { vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => this.dispatch(input, init)); }
  deactivate() { vi.unstubAllGlobals(); }
  disableNetConnect() { this.netConnect = false; }
  enableNetConnect() { this.netConnect = true; }
  get(origin: string) { return new Interceptable(origin, this.list); }
  pendingInterceptors() { return this.list.filter(i => i.times > 0 && i.times !== Infinity); }
  assertNoPendingInterceptors() {
    const p = this.pendingInterceptors();
    if (p.length) throw new Error(`${p.length} interceptor(s) not consumed: ${p.map(i => `${String(i.opts.method ?? 'GET')} ${i.origin}${typeof i.opts.path === 'string' ? i.opts.path : '<fn>'}`).join(', ')}`);
  }
  private async dispatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const path = url.pathname + url.search;
    const headers = Object.fromEntries(req.headers);
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : new TextDecoder().decode(await req.arrayBuffer()); // arrayBuffer: workerd warns on .text() for form bodies
    const i = this.list.find(i => i.times > 0 && i.origin === url.origin && match(i.opts.path, path) && match(i.opts.method ?? 'GET', req.method)
      && (!i.opts.headers || Object.entries(i.opts.headers).every(([k, m]) => match(m, headers[k.toLowerCase()] ?? '')))
      && match(i.opts.body, body ?? ''));
    if (!i) {
      if (this.netConnect) return this.real(input, init);
      throw new TypeError(`fetch-mock: no interceptor for ${req.method} ${req.url}`);
    }
    i.times--;
    if (i.delayMs) await new Promise<void>((res, rej) => {
      const t = setTimeout(res, i.delayMs);
      req.signal.addEventListener('abort', () => { clearTimeout(t); rej(req.signal.reason ?? new DOMException('aborted', 'AbortError')); });
    });
    const data = typeof i.data === 'function' ? i.data({ path, origin: url.origin, method: req.method, body, headers }) : i.data;
    const h = new Headers(i.headers);
    const json = typeof data !== 'string';
    if (json && !h.has('content-type')) h.set('content-type', 'application/json');
    return new Response(json ? JSON.stringify(data) : data, { status: i.status, headers: h });
  }
}
export const fetchMock = new FetchMock();
