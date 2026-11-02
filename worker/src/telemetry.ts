// worker/src/telemetry.ts: usage events as Sentry logs marked `crashyard.action`, which crashyard (the DSN's server)
// stores as product analytics. From the server only: no page script and no cookie of its own. The user is a random id
// minted when a Spotify session starts and carried into the job, so the events of one session line up, and an error
// reported after them in the same run carries it too. The properties are counts and durations, never titles, emails,
// tokens or IPs. Without SENTRY_DSN (forks, tests, local dev) nothing is sent.
import * as Sentry from '@sentry/cloudflare';

type Props = Record<string, string | number | boolean | null | undefined>;
export function track(event: string, tid: string | undefined, props: Props = {}): void {
  if (tid) Sentry.setUser({ id: tid });
  const attributes: Record<string, string | number | boolean> = { 'crashyard.action': true };
  for (const [k, v] of Object.entries(props)) if (v != null) attributes[k] = v;
  Sentry.logger.info(event, attributes);
}

// A browser opening a page that exists (not an asset, a prefetch or most crawlers, which send no Sec-Fetch-Dest): its
// path and the host of the site it came from, never the query. No user, as no cookie ties one visit to the next.
export function pageView(req: Request, res: Response): Props | undefined {
  if (!res.ok || req.headers.get('sec-fetch-dest') !== 'document') return;
  const url = new URL(req.url);
  const from = URL.parse(req.headers.get('referer') ?? '');
  return { path: url.pathname, referrer: from && from.host !== url.host ? from.hostname : undefined };
}
