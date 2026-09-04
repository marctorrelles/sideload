// worker/src/telemetry.ts: usage events to Mixpanel over its HTTP API, from the server only. No page script and no
// cookie of its own: distinct_id is a random id minted when a Spotify session starts and carried into the job. The
// properties are counts and durations, never titles, emails, tokens or IPs (ip=0 keeps Mixpanel from geolocating the
// Worker). Without MIXPANEL_TOKEN (forks, tests, local dev) nothing is sent.
import type { Env } from './env';

type Props = Record<string, string | number | boolean | null | undefined>;
export async function track(
  env: Pick<Env, 'MIXPANEL_TOKEN' | 'MIXPANEL_API'>,
  event: string,
  distinctId: string | undefined,
  props: Props = {},
): Promise<void> {
  if (!env.MIXPANEL_TOKEN) return;
  const body = [
    {
      event,
      properties: {
        token: env.MIXPANEL_TOKEN,
        distinct_id: distinctId ?? 'anonymous',
        time: Date.now(),
        $insert_id: crypto.randomUUID(),
        ...props,
      },
    },
  ];
  try {
    const r = await fetch(`${env.MIXPANEL_API ?? 'https://api.mixpanel.com'}/track?ip=0`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/plain' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) console.error(JSON.stringify({ evt: 'telemetry_error', status: r.status }));
  } catch (e) {
    console.error(JSON.stringify({ evt: 'telemetry_error', err: String(e).slice(0, 200) }));
  }
}
