// web/src/islands/Connect.tsx: step 01. Source: BYO Spotify app (PKCE). Destination: YouTube Music via Google device code.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../lib/api';
import type { SessionView } from '@shared/types';
import { n } from '../lib/format';
import { Logo } from '../lib/Logo';
import { countTo, reveal } from '../lib/motion';
const REDIRECT = `${location.origin}/auth/spotify/callback`;
const SPOTIFY_ERRORS: Record<string, string> = {
  state_mismatch: 'That sign-in link expired. Try again.',
  access_denied: 'You cancelled the Spotify sign-in.',
  invalid_client: 'Spotify did not recognise that Client ID. Check it in your dashboard.',
  invalid_grant: 'Spotify rejected the sign-in. Make sure the redirect URI below is saved in your app, then try again.',
  token_exchange_failed: 'Spotify sign-in failed. Try again in a minute.',
  no_code: 'Spotify sent us back without a code. Try again.',
  premium_required:
    'Spotify requires the owner of a Development Mode app to have an active Premium subscription. Just subscribed? Spotify can take a few hours to notice. Try again later.',
  http_error: 'Spotify answered with an error while reading your account. Try again in a minute.',
};
type Dev = { userCode: string; verificationUrl: string; interval: number; expiresIn: number };
export default function Connect() {
  const [s, setS] = useState<SessionView | null>(null);
  const [clientId, setClientId] = useState(() => {
    try {
      return localStorage.getItem('sl_client_id') ?? '';
    } catch {
      return '';
    }
  });
  const [err, setErr] = useState<string | null>(() => {
    const e = new URLSearchParams(location.search).get('spotify_error');
    return e ? (SPOTIFY_ERRORS[e] ?? `Spotify error: ${e}`) : null;
  });
  const [dev, setDev] = useState<Dev | null>(null);
  const [devState, setDevState] = useState<'idle' | 'code' | 'denied' | 'expired' | 'error'>('idle');
  const [copied, setCopied] = useState<'redirect' | 'code' | null>(null);
  const timer = useRef<number>();
  const codeRef = useRef<HTMLSpanElement>(null);
  // the card that connected just now glows once: Spotify comes back through a redirect (query flag), Google connects in place
  const [lit, setLit] = useState<'spotify' | 'google' | null>(() =>
    new URLSearchParams(location.search).get('connected') === 'spotify' ? 'spotify' : null,
  );
  useEffect(() => {
    if (lit === 'spotify')
      document
        .querySelectorAll<HTMLElement>('.card [data-count]')
        .forEach((el) => countTo(el, Number(el.dataset.count), (v) => n(v)));
  }, [lit, s?.spotify?.counts.playlists]);
  useEffect(() => {
    if (codeRef.current) reveal(codeRef.current);
  }, [dev?.userCode]);
  useEffect(() => {
    api
      .session()
      .then(setS)
      .catch(() => setS({ spotify: null, destination: null }));
    history.replaceState(null, '', location.pathname);
    return () => clearTimeout(timer.current);
  }, []);

  async function startSpotify(e: Event) {
    e.preventDefault();
    setErr(null);
    const id = clientId.trim().toLowerCase();
    try {
      try {
        localStorage.setItem('sl_client_id', id);
      } catch {}
      const { url } = await api.spotifyStart(id);
      location.href = url;
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not start the Spotify sign-in.');
    }
  }
  async function startGoogle() {
    setDevState('code');
    let d: Dev;
    try {
      d = await api.googleStart();
    } catch {
      setDevState('error');
      return;
    }
    setDev(d);
    let interval = d.interval * 1000;
    const poll = async () => {
      const r = await api.googlePoll().catch(() => ({ status: 'pending' as const }));
      if (r.status === 'connected') {
        setS(await api.session());
        setDevState('idle');
        setDev(null);
        setLit('google');
        return;
      }
      if (r.status === 'denied' || r.status === 'expired') {
        setDevState(r.status);
        setDev(null);
        return;
      }
      if (r.status === 'slow_down') interval += 5000;
      timer.current = window.setTimeout(poll, interval);
    };
    timer.current = window.setTimeout(poll, interval);
  }
  const copy = (what: 'redirect' | 'code', text: string) => () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  const both = !!s?.spotify && !!s?.destination;
  if (!s) return <p class="meta connect__loading">Checking your session…</p>;
  return (
    <>
      <div class="cards">
        <div class={`wire ${both ? 'is-on' : s.spotify ? 'is-half' : ''}`} aria-hidden="true" />
        <section
          class={`panel card ${s.spotify ? 'panel--success' : ''} ${lit === 'spotify' ? 'is-lit' : ''}`}
          aria-labelledby="src"
        >
          <header class="card__head">
            <span class="art art--46">
              <Logo name="spotify" size={30} />
            </span>
            <div>
              <div class="eyebrow">Source</div>
              <h2 id="src" class="card__title">
                Spotify
              </h2>
            </div>
            {s.spotify && <span class="meta is-ok card__state">connected</span>}
          </header>
          {s.spotify ? (
            <>
              <dl class="kv hairline-top">
                <dt>Signed in as</dt>
                <dd>{s.spotify.email ?? s.spotify.displayName}</dd>
                <dt>Access</dt>
                <dd class="mono">read-only</dd>
                <dt>Found</dt>
                <dd class="mono">
                  <span data-count={s.spotify.counts.playlists}>{n(s.spotify.counts.playlists)}</span> playlists ·{' '}
                  <span data-count={s.spotify.counts.liked}>{n(s.spotify.counts.liked)}</span> liked songs
                </dd>
              </dl>
              <button
                class="link card__link"
                onClick={async () => {
                  await api.spotifyLogout();
                  setS(await api.session());
                }}
              >
                Use a different account
              </button>
            </>
          ) : (
            <form onSubmit={startSpotify} class="setup">
              <p class="lede lede--card">
                Spotify limits every new app to 5 people, so Sideload can't sign you in with a shared button. Make your
                own app: two minutes, needs Premium.
              </p>
              <ol class="steps">
                <li>
                  Open{' '}
                  <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">
                    developer.spotify.com/dashboard
                  </a>{' '}
                  → <b>Create app</b>.
                </li>
                <li>
                  Any name. Redirect URI: <code>{REDIRECT}</code>{' '}
                  <button type="button" class="link" onClick={copy('redirect', REDIRECT)}>
                    {copied === 'redirect' ? 'copied' : 'copy'}
                  </button>
                </li>
                <li>
                  Tick <b>Web API</b>, save, then paste the <b>Client ID</b> here.
                </li>
              </ol>
              <label class="field">
                <span class="eyebrow">Client ID</span>
                <input
                  class="input"
                  value={clientId}
                  onInput={(e) => setClientId((e.target as HTMLInputElement).value)}
                  pattern="[a-fA-F0-9]{32}"
                  required
                  autocomplete="off"
                  spellcheck={false}
                  placeholder="32 hex characters"
                  inputMode="text"
                />
              </label>
              {err && (
                <p class="error" role="alert">
                  {err}
                </p>
              )}
              <button class="btn btn--block card__cta" type="submit">
                Continue with Spotify
              </button>
            </form>
          )}
        </section>
        <section class={`panel panel--accent card ${lit === 'google' ? 'is-lit' : ''}`} aria-labelledby="dst">
          <div class="eyebrow c-accent">Destination</div>
          <h2 id="dst" class="card__title">
            Where is your library going?
          </h2>
          <div class="list providers" role="radiogroup" aria-label="Destination">
            <div class="row is-selected" role="radio" aria-checked="true" tabIndex={0}>
              <Logo name="ytmusic" size={26} />
              <span class="row__title">YouTube Music</span>
              <span class="row__count c-accent">{s.destination ? 'connected' : 'chosen'}</span>
            </div>
            <div class="row is-disabled" role="radio" aria-checked="false" aria-disabled="true">
              <Logo name="apple" size={26} />
              <span class="row__title">Apple Music</span>
              <span class="chip">soon</span>
            </div>
            <div class="row is-disabled" role="radio" aria-checked="false" aria-disabled="true">
              <Logo name="tidal" size={26} />
              <span class="row__title">Tidal</span>
              <span class="chip">soon</span>
            </div>
          </div>
          {s.destination ? (
            <>
              <dl class="kv hairline-top">
                <dt>Signed in as</dt>
                <dd>
                  {s.destination.account ? (
                    <>
                      {s.destination.account.title}
                      {s.destination.account.handle && <span class="meta"> · {s.destination.account.handle}</span>}
                    </>
                  ) : (
                    'your YouTube account'
                  )}
                </dd>
                <dt>Access</dt>
                <dd class="mono">write · playlists, likes, subscriptions</dd>
              </dl>
              <button
                class="link card__link"
                onClick={async () => {
                  await api.googleLogout();
                  setS(await api.session());
                }}
              >
                Use a different account
              </button>
            </>
          ) : devState === 'code' ? (
            <div class="devcode" aria-live="polite">
              {dev ? (
                <>
                  <p class="lede lede--card">
                    Open{' '}
                    <a href={dev.verificationUrl} target="_blank" rel="noopener">
                      {dev.verificationUrl.replace('https://', '')}
                    </a>{' '}
                    on any device and enter this code:
                  </p>
                  <p class="code">
                    <span class="code__chars reveal" ref={codeRef}>
                      {dev.userCode.split('').map((ch, i) => (
                        <i key={i}>{ch}</i>
                      ))}
                    </span>
                    <button type="button" class="btn btn--small code__copy" onClick={copy('code', dev.userCode)}>
                      {copied === 'code' ? 'copied' : 'copy'}
                    </button>
                  </p>
                  <p class="meta">Waiting for Google… this page updates by itself.</p>
                </>
              ) : (
                <p class="meta">Asking Google for a code…</p>
              )}
            </div>
          ) : (
            <>
              {devState === 'denied' && (
                <p class="error" role="alert">
                  You declined on Google's side. Try again when ready.
                </p>
              )}
              {devState === 'expired' && (
                <p class="error" role="alert">
                  That code expired. Get a new one.
                </p>
              )}
              {devState === 'error' && (
                <p class="error" role="alert">
                  Google did not answer. Try again in a minute.
                </p>
              )}
              <button
                class="btn btn--block card__cta"
                onClick={startGoogle}
                disabled={!s.spotify}
                aria-disabled={!s.spotify}
              >
                Sign in to YouTube Music
              </button>
              <p class="note">
                Google shows this as full YouTube access: it has no narrower permission that can write playlists, likes
                and subscriptions. Sideload never deletes anything.
              </p>
              {!s.spotify && <p class="note">Connect Spotify first.</p>}
            </>
          )}
        </section>
      </div>
      <div class="actionbar hairline-top">
        <span class="meta">We drop your Spotify token when the transfer finishes</span>
        <a
          key={both ? 'ready' : 'waiting'}
          class={`btn ${both ? '' : 'is-disabled'}`}
          aria-disabled={!both}
          href="/select"
        >
          Choose what to move
        </a>
      </div>
    </>
  );
}
