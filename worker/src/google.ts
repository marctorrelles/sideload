// worker/src/google.ts
export const YT_SCOPE = 'https://www.googleapis.com/auth/youtube';
const TOKEN = 'https://oauth2.googleapis.com/token';
export class GoogleError extends Error { constructor(public code: string) { super(code); } }

async function post(url: string, data: Record<string, string>): Promise<Record<string, any>> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data), signal: AbortSignal.timeout(30_000) });
  return r.json() as Promise<Record<string, any>>;
}
export async function deviceCode(clientId: string) {
  const j = await post('https://oauth2.googleapis.com/device/code', { client_id: clientId, scope: YT_SCOPE });
  if (!j.device_code) throw new GoogleError(j.error ?? 'device_code_failed');
  return { deviceCode: j.device_code as string, userCode: j.user_code as string, verificationUrl: j.verification_url as string, expiresIn: j.expires_in as number, interval: (j.interval as number | undefined) ?? 5 };
}
export type PollResult = { status: 'pending' | 'slow_down' | 'denied' | 'expired' } | { status: 'ok'; access: string; refresh: string; expiresAt: number };
export async function pollDevice(clientId: string, secret: string, deviceCode: string): Promise<PollResult> {
  const j = await post(TOKEN, { client_id: clientId, client_secret: secret, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  if (j.access_token) return { status: 'ok', access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 };
  if (j.error === 'authorization_pending') return { status: 'pending' };
  if (j.error === 'slow_down') return { status: 'slow_down' };
  if (j.error === 'access_denied') return { status: 'denied' };
  return { status: 'expired' };
}
/** Channel behind the token (Data API `channels.list mine`, 1 unit). Null on any failure: cosmetic, never blocks connecting. */
export async function channelInfo(access: string): Promise<{ title: string; handle: string | null } | null> {
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const j = await r.json() as { items?: { snippet?: { title?: string; customUrl?: string } }[] };
    const sn = j.items?.[0]?.snippet;
    return sn?.title ? { title: sn.title, handle: sn.customUrl ?? null } : null;
  } catch { return null; }
}
export async function refreshGoogle(clientId: string, secret: string, refresh: string): Promise<{ access: string; expiresAt: number }> {
  const j = await post(TOKEN, { client_id: clientId, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' });
  if (!j.access_token) throw new GoogleError(j.error ?? 'refresh_failed');
  return { access: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
}
