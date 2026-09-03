// web/src/islands/Transfer.tsx: /t/:id. Polls the job and renders running / paused / done / failed / not found.
// Reload safety is the core promise: the page is a pure viewer of job state and progress never runs backwards.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../lib/api';
import type { JobView, ReviewItemView, JobEventKind } from '@shared/types';
import { n, pct, eta, duration } from '../lib/format';
import { countTo, flash, crossfade, reveal } from '../lib/motion';
import ReviewItem from './ReviewItem';
const FAILURE: Record<string, string> = {
  auth_expired: 'One of the sign-ins expired mid-transfer. Nothing was deleted anywhere. Start another transfer: songs already matched are cached, so it will be fast.',
  provider_error: 'Spotify or YouTube kept returning errors for a long time. Start another transfer in a while; matched songs are cached.',
  too_large: 'That is more than 25,000 songs. Split it into two transfers.',
  timeout: 'The transfer ran for 24 hours without finishing, so it was stopped. Start another one; matched songs are cached.',
};
const ACTIVE = ['fetching', 'matching', 'writing', 'verifying'];
const GLYPH: Record<JobEventKind, string> = { read: '>', match: '+', review: '?', create: '+', add: '+', verify: '~', entity: '*', throttle: '!' };
function StepBar({ done }: { done: boolean }) {
  const steps = [[1, 'Connect'], [2, 'Choose'], [3, 'Transfer']] as const;
  return <div class={`stepbar hairline-bottom is-step-${done ? 'done' : 3}`}><ol class="container stepbar__in"><i class="stepbar__wire" aria-hidden="true" />
    {steps.map(([k, label]) => { const st = done || k < 3 ? 'done' : 'current'; const inner = <><span class="num">0{k}</span> <span class="label">{label}</span>{st === 'done' && <span class="tick"> ✓</span>}</>; return <li class={`step is-${st} ${done && k === 3 ? 'is-final' : ''}`} aria-current={st === 'current' ? 'step' : undefined}>{inner}</li>; })} {/* no links back: the session is cleared when the job starts, so Connect and Choose would only bounce */}
  </ol></div>;
}
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches);
  useEffect(() => { const mq = matchMedia('(max-width: 900px)'); const f = () => setNarrow(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  return narrow;
}
export default function Transfer() {
  const id = location.pathname.split('/')[2] ?? '';
  const [job, setJob] = useState<JobView | null | undefined>(undefined); // undefined = loading, null = 404
  const [more, setMore] = useState<ReviewItemView[]>([]);
  const [showReview, setShowReview] = useState(false);
  const narrow = useNarrow();
  const movedRef = useRef(0);
  useEffect(() => {
    let stop = false, t = 0;
    const tick = async () => {
      try {
        const j = await api.job(id);
        if (stop) return;
        if (j.totals.moved < movedRef.current) j.totals.moved = movedRef.current; // never backwards on reconnect
        movedRef.current = j.totals.moved;
        setJob(j);
        if (j.status === 'running') t = window.setTimeout(tick, document.hidden ? 10_000 : 2_500);
        else if (j.status === 'paused') t = window.setTimeout(tick, 10_000);
      } catch (e) { if (e instanceof ApiError && e.status === 404) setJob(null); else t = window.setTimeout(tick, 8_000); }
    };
    tick();
    const vis = () => { if (!document.hidden) { clearTimeout(t); tick(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
  }, [id]);
  useEffect(() => { document.querySelectorAll<HTMLElement>('[data-count]').forEach(el => countTo(el, Number(el.dataset.count), v => n(v))); }, [job?.totals.moved, job?.status]);
  useEffect(() => { const el = document.querySelector('[data-reveal-once]'); if (el && !el.hasAttribute('data-revealed')) { el.setAttribute('data-revealed', ''); reveal(el); } }, [job?.status]);
  if (job === undefined) return <><StepBar done={false} /><section class="container body"><p class="meta">Loading transfer…</p></section></>;
  if (job === null) return <><StepBar done={false} /><section class="container body"><a class="back" href="/">← Home</a><p class="eyebrow c-accent">404</p><h1 class="h2">This transfer doesn't exist any more.</h1><p class="lede">Transfers are deleted 7 days after they finish. <a href="/connect">Start another one.</a></p></section></>;
  const { totals } = job;
  const p = pct(totals.moved, totals.tracks);
  const remaining = Math.max(0, totals.tracks - totals.moved - totals.matched - totals.review - totals.skipped);
  const review = [...job.review, ...more.filter(m => !job.review.some(r => r.id === m.id))]; // page 0 shifts after a resolve; never render a row twice
  const copy = (e: Event) => { const el = e.currentTarget as HTMLElement; navigator.clipboard.writeText(location.href).then(() => flash(el, 'copied')); };
  const onResolved = async (trackId: number) => {
    setJob({ ...job, review: job.review.filter(r => r.id !== trackId), reviewTotal: Math.max(0, job.reviewTotal - 1), totals: { ...totals, review: Math.max(0, totals.review - 1) } }); setMore(more.filter(r => r.id !== trackId));
    try { setJob(await api.job(id)); } catch { /* the optimistic state stands until the next load */ } // moved/review totals come from the worker's track rows
  };
  const loadMore = async () => setMore([...more, ...(await api.review(id, review.filter(r => r.id > 0).length))]);
  const reviewList = <div class="list warn" data-reveal-once>
    {review.map(r => <ReviewItem key={r.id} jobId={id} item={r} onResolved={onResolved} disabled={job.status === 'done' && !job.ytConnected} />)}
    {job.reviewTotal > review.length && <button class="row row__more" onClick={loadMore}>+ {n(job.reviewTotal - review.length)} more</button>}
    {review.length === 0 && <div class="row"><span class="row__sub">Nothing to review{job.status === 'done' ? '' : ' so far'}.</span></div>}
  </div>;

  if (job.status === 'done') return <DoneView job={job} reviewList={reviewList} narrow={narrow} showReview={showReview} setShowReview={setShowReview} />;
  const failed = job.status === 'failed';
  return <>
    <StepBar done={false} />
    {!failed && <div class={`banner ${job.status === 'paused' ? 'is-paused' : ''}`}><div class="container banner__in">
      <div><b class="c-soft">{job.status === 'paused' ? 'Paused.' : 'You can close this tab.'}</b> <span class="fg2">{job.status === 'paused' ? 'Nothing is being moved until you resume. Your link keeps working.' : 'The transfer runs on our side. Come back to this link any time to see where it got to.'}</span></div>
      <button class="link mono banner__copy" onClick={copy}>{location.host}/t/{id.slice(0, 5)}… · copy link</button>
    </div></div>}
    <section class="container body">
      <div class="progress-head">
        <div>
          <h1 class="h2">{failed ? 'The transfer stopped.' : 'Transferring your library'}</h1>
          <p class="lede progress-sub" aria-live="polite">{failed ? FAILURE[job.failure ?? ''] ?? 'Something went wrong on our side.' : <>{n(totals.moved)} of {n(totals.tracks)} songs moved to YouTube Music · {job.throttledUntil ? `YouTube asked us to slow down, retrying at ${new Date(job.throttledUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : job.status === 'paused' ? 'paused' : eta(job.etaSeconds)}</>}</p>
          {failed && <div class="actions"><a class="btn" href="/connect">Start another transfer</a><a class="btn btn--secondary" href={`/api/jobs/${id}/report.csv`}>Download report</a></div>}
        </div>
        <div class={`pct ${failed ? 'pct--danger' : ''}`} aria-hidden="true">{p}%</div>
      </div>
      <div class="seg" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Transfer progress"><i class="moved" style={`--w:${totals.moved}`} /><i class="matched" style={`--w:${totals.matched}`} /><i class="review" style={`--w:${totals.review}`} /><i class="rest" style={`--w:${remaining}`} /></div>
      <div class="legend meta"><span><i class="sw sw--moved" /><b data-count={totals.moved}>{n(totals.moved)}</b> moved</span>{totals.matched > 0 && <span><i class="sw sw--matched" />{n(totals.matched)} found, adding next</span>}<span class="c-soft"><i class="sw sw--review" />{n(totals.review)} need review</span><span><i class="sw sw--rest" />{n(remaining)} to go</span></div>
      {job.covers.length > 0 && <div class="wall" aria-hidden="true">{job.covers.map(v => <img key={v} class="wall__tile" src={`https://i.ytimg.com/vi/${v}/default.jpg`} alt="" loading="lazy" />)}</div>}
      <div class="cols">
        <div>
          <div class="eyebrow col__label">Activity</div>
          <div class="list activity">{job.items.map(i => <ActivityRow key={i.id} item={i} />)}</div>
          {job.recent.length > 0 && <>
            <div class="eyebrow col__label feed__label">Live</div>
            <ol class="feed" aria-live="polite">{[...job.recent].reverse().map(e => <li key={`${e.at}${e.text}`} class={`feed__row feed__row--${e.kind}`}><span class="feed__glyph" aria-hidden="true">{GLYPH[e.kind]}</span><span class="feed__text">{e.text}{e.sub && <span class="feed__sub"> · {e.sub}</span>}</span></li>)}</ol>
          </>}
        </div>
        <div>
          {narrow ? <>
            <button class="row row__toggle" aria-expanded={showReview} onClick={() => setShowReview(!showReview)}><span class="c-soft">{n(job.reviewTotal)} song{job.reviewTotal === 1 ? '' : 's'} need{job.reviewTotal === 1 ? 's' : ''} review</span><span class="row__count c-soft">{showReview ? 'Hide' : 'Review →'}</span></button>
            {showReview && reviewList}
          </> : <>
            <div class="review-head"><span class="eyebrow c-soft">Needs your review · {n(job.reviewTotal)}</span><span class="meta">you can do this later</span></div>
            {reviewList}
          </>}
          {!failed && <div class="actions actions--split">
            {job.status === 'running' ? <button class="btn btn--secondary" onClick={async () => { setJob({ ...job, status: 'paused' }); await api.pause(id).catch(() => setJob({ ...job, status: 'running' })); }}>Pause transfer</button>
              : <button class="btn" onClick={async () => { setJob({ ...job, status: 'running' }); await api.resume(id).catch(() => setJob({ ...job, status: 'paused' })); }}>Resume</button>}
            <a class="btn btn--secondary" href={`/api/jobs/${id}/report.csv`}>Download report</a>
          </div>}
        </div>
      </div>
    </section>
  </>;
}
function ActivityRow({ item }: { item: JobView['items'][number] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const entity = item.kind === 'album' || item.kind === 'artist';
  const status = item.status === 'done' ? (item.review ? `${n(item.moved)} of ${n(item.total)} · ${n(item.review)} to review` : entity ? 'added' : `all ${n(item.total)} songs`)
    : item.status === 'failed' ? (item.kind === 'playlist' ? "can't be read" : 'not found')
    : item.status === 'queued' ? (entity ? 'up next' : `up next · ${n(item.total)}`)
    : item.status === 'verifying' ? `${n(item.moved)} of ${n(item.total)} · checking`
    : item.status === 'fetching' ? 'reading'
    : item.status === 'matching' ? `${n(item.moved + item.matched)} of ${n(item.total)} found`
    : entity ? 'adding' : `${n(item.moved)} of ${n(item.total)}`;
  useEffect(() => { if (ref.current) crossfade(ref.current); }, [status]);
  const cls = item.status === 'done' && !item.review ? 'is-ok' : item.review || item.status === 'failed' ? 'is-warn' : '';
  return <div class={`row ${ACTIVE.includes(item.status) ? 'is-active' : ''} ${item.status === 'queued' ? 'is-dim' : ''}`}>
    <span class="row__text"><div class="row__title">{item.name}</div>{(item.status === 'matching' || item.status === 'writing') && item.total > 0 && !entity && <div class="track track--inline"><i style={`--pct:${pct(item.moved + item.matched, item.total)}%`} /></div>}</span>
    <span class={`row__count ${cls}`} ref={ref}>{status}</span>
  </div>;
}
function DoneView({ job, reviewList, narrow, showReview, setShowReview }: { job: JobView; reviewList: preact.JSX.Element; narrow: boolean; showReview: boolean; setShowReview: (v: boolean) => void }) {
  const { totals } = job;
  const playlists = job.items.filter(i => (i.kind === 'playlist' || i.kind === 'liked') && i.status === 'done').length;
  const albums = job.items.filter(i => i.kind === 'album' && i.status === 'done').length;
  const artists = job.items.filter(i => i.kind === 'artist' && i.status === 'done').length;
  const notFound = totals.review; // includes failed albums/artists/unreadable playlists (view() counts each as one review entry)
  const [disconnected, setDisconnected] = useState(!job.ytConnected);
  return <>
    <StepBar done />
    <section class="container body done">
      <div class="reveal">
        <div class="eyebrow c-ok done__eyebrow">Transfer complete · {duration((job.finishedAt ?? Date.now()) - job.startedAt)}</div>
        <h1 class="h2-done">Your library lives on YouTube Music now.</h1>
        <p class="lede done__lede">
          {n(totals.moved)} of {n(totals.tracks)} songs moved across {playlists} playlist{playlists === 1 ? '' : 's'}{albums || artists ? `, plus ${albums ? `${albums} album${albums === 1 ? '' : 's'}` : ''}${albums && artists ? ' and ' : ''}${artists ? `${artists} followed artist${artists === 1 ? '' : 's'}` : ''}` : ''}.
          {' '}{notFound ? `${n(notFound)} ${notFound === 1 ? "song didn't" : "songs didn't"} exist on the other side. ${notFound === 1 ? "It's" : "They're"} listed ${narrow ? 'below' : 'to the right'} so nothing goes missing quietly.` : 'Everything matched.'}
          {totals.collapsed ? ` ${n(totals.collapsed)} of those share a YouTube video with another track (remixes, live takes, re-releases). Check them if the difference matters to you.` : ''}
          {totals.writeFailed ? ` ${n(totals.writeFailed)} were accepted by YouTube but never showed up; "Try again" re-adds them.` : ''}
        </p>
        <div class="statstrip">
          <div><b class="stat" data-count={totals.moved}>{n(totals.moved)}</b><span class="eyebrow">songs moved</span></div>
          <div><b class="stat">{playlists}</b><span class="eyebrow">playlists</span></div>
          <div class="statstrip__albums"><b class="stat">{albums}</b><span class="eyebrow">albums</span></div>
          <div><b class="stat c-soft">{n(notFound)}</b><span class="eyebrow">not found</span></div>
        </div>
        <div class="actions done__actions"><a class="btn btn--pulse" href="https://music.youtube.com/library" target="_blank" rel="noopener">Open YouTube Music</a><a class="btn btn--secondary" href={`/api/jobs/${job.id}/report.csv`}>Download report (CSV)</a><a class="link" href="/connect">Start another transfer</a></div>
        <div class="panel panel--accent coffee">
          <div><b class="coffee__title">Sideload is free, and stays free.</b><p class="note coffee__note">If it saved you an afternoon of copy-pasting, a coffee covers the server bill for the next few hundred transfers.</p></div>
          <a class="btn" href="https://buymeacoffee.com/marctorrelles" rel="noopener noreferrer">Buy me a coffee</a>
        </div>
      </div>
      <div>
        {narrow ? <>
          <button class="row row__toggle" aria-expanded={showReview} onClick={() => setShowReview(!showReview)}><span class="c-soft">{n(notFound)} song{notFound === 1 ? '' : 's'} couldn't be moved</span><span class="row__count c-soft">{showReview ? 'Hide' : 'See list →'}</span></button>
          {showReview && reviewList}
        </> : <>
          <div class="review-head"><span class="eyebrow c-soft">Couldn't be moved · {n(notFound)}</span><span class="meta">saved to your report</span></div>
          {reviewList}
        </>}
        <div class="reassure">Your Spotify library is untouched: nothing was deleted, and that connection was dropped when the transfer finished. {disconnected ? 'The YouTube Music connection has been dropped too.' : <>The YouTube Music connection stays for 24 hours so you can fix the list above. <button class="link" onClick={async () => { await api.disconnect(job.id); setDisconnected(true); location.reload(); }}>Disconnect now</button></>}</div>
      </div>
    </section>
  </>;
}
