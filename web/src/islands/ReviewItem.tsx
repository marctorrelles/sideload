// web/src/islands/ReviewItem.tsx: one "needs your review" row with its actions.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../lib/api';
import type { ReviewItemView, ReviewAction, ManualSearchResult } from '@shared/types';
import { collapse } from '../lib/motion';
function reasonCopy(item: ReviewItemView): string {
  switch (item.reason) {
    case 'low_confidence': return `No exact match. Closest: "${item.suggestion?.title ?? '?'}"${item.suggestion?.artists ? ` by ${item.suggestion.artists}` : ''}`;
    case 'local_file': return "Local files can't be transferred";
    case 'unavailable': return 'Not available on YouTube Music';
    case 'duplicate_match': return `Same YouTube video as "${item.collidesWith}", probably a remix, live take or re-release.`;
    case 'write_failed': return 'YouTube said yes, but the song never showed up.';
    case 'not_accessible': return "Spotify doesn't let a personal app read this playlist (it belongs to someone else).";
    default: return item.kind === 'album' || item.kind === 'artist' ? 'Not found on YouTube Music.' : 'No exact match found.';
  }
}
const yt = (id: string) => `https://music.youtube.com/watch?v=${id}`;
const Ext = () => <svg class="ext" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>;
const dur = (s: number | null) => (s == null ? '' : ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
export default function ReviewItem({ jobId, item, onResolved, disabled = false }: { jobId: string; item: ReviewItemView; onResolved: (id: number) => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'idle' | 'search' | 'busy'>('idle');
  const [q, setQ] = useState(`${item.artist} ${item.title}`.trim()); // prefilled; the first search runs as soon as the box opens
  const [results, setResults] = useState<ManualSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act(a: ReviewAction, done: string) {
    setMode('busy'); setErr(null);
    try {
      await api.resolve(jobId, item.id, a);
      const el = ref.current;
      if (el) { const r = el.querySelector<HTMLElement>('.review__reason'); if (r) { r.textContent = done; r.classList.add('is-ok'); } await new Promise(res => setTimeout(res, 350)); await collapse(el); }
      onResolved(item.id);
    } catch (e) {
      setMode('idle');
      setErr(e instanceof ApiError && e.code === 'disconnected' ? 'Connection dropped. Start another transfer to fix this one.' : e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    }
  }
  async function runSearch(query: string) {
    if (query.length < 2) return;
    setResults(null); setErr(null); setSearching(true);
    try { setResults(await api.search(jobId, query)); }
    catch (x) { setErr(x instanceof ApiError && x.code === 'disconnected' ? 'Connection dropped. Start another transfer to search.' : 'Search failed. Try again.'); }
    finally { setSearching(false); }
  }
  const search = (e: Event) => { e.preventDefault(); runSearch(q.trim()); };
  useEffect(() => { if (mode === 'search' && results === null) runSearch(q.trim()); }, [mode]);
  const closestLabel = item.reason === 'duplicate_match' ? 'Add anyway' : item.reason === 'write_failed' ? 'Try again' : 'Use closest';
  const canAct = item.actionable && !disabled && mode !== 'busy';
  return <div class="review" ref={ref}>
    <div class="review__head"><span class="review__title">{item.artist ? `${item.artist} - ` : ''}{item.title}</span><span class="meta review__where">{item.itemName}</span></div>
    <p class="review__reason">{item.reason === 'low_confidence' && item.suggestion ? <>No exact match. Closest: <a class="review__yt" href={yt(item.suggestion.videoId)} target="_blank" rel="noopener">"{item.suggestion.title}"{item.suggestion.artists ? ` by ${item.suggestion.artists}` : ''} <Ext /></a></> : reasonCopy(item)}</p>
    {canAct && <div class="review__actions">
      {item.suggestion && <button class="btn btn--small" onClick={() => act({ action: 'closest' }, 'Added')}>{closestLabel}</button>}
      <button class={`btn btn--small ${item.suggestion ? 'is-dim' : ''}`} aria-expanded={mode === 'search'} onClick={() => setMode(mode === 'search' ? 'idle' : 'search')}>Search manually</button>
      <button class="link" onClick={() => act({ action: 'skip' }, 'Skipped. Kept in your report')}>Skip</button>
    </div>}
    {mode === 'search' && <form class="review__search" onSubmit={search}>
      <div class="review__searchrow"><input class="input" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} placeholder={`${item.artist} ${item.title}`.trim()} aria-label="Search YouTube Music" autofocus /><button class="btn btn--small" type="submit">Search</button></div>
      {searching && <ul class="review__results skeleton" aria-busy="true" aria-label="Searching YouTube Music">{[0, 1, 2].map(i => <li key={i}><span class="review__result"><span class="sk sk--title" /><span class="sk sk--sub" /></span><span class="sk sk--btn" /></li>)}</ul>}
      {!searching && results && (results.length ? <ul class="review__results">{results.map(r => <li key={r.videoId}><span class="review__result"><a class="review__yt" href={yt(r.videoId)} target="_blank" rel="noopener">{r.artists ? `${r.artists} - ` : ''}{r.title} <Ext /></a><span class="meta review__result-sub">{r.album ?? ''}{dur(r.durationSec).replace(/^ · /, r.album ? ' · ' : '')}</span></span><button type="button" class="btn btn--small" onClick={() => act({ action: 'manual', videoId: r.videoId }, 'Added')}>Use this</button></li>)}</ul> : <p class="meta review__none">No results on YouTube Music.</p>)}
    </form>}
    {mode === 'busy' && <p class="meta">Working…</p>}
    {err && <p class="error" role="alert">{err}</p>}
  </div>;
}
