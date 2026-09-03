// web/src/islands/Select.tsx: step 02. Tabs, tri-state select-all, shift-click ranges, summary panel.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../lib/api';
import type { Library } from '@shared/types';
import { defaultSel, totals, triState, rangeToggle, sortBy, toSelection, selectable, type Sel, type Tab } from '../lib/selection';
import { n, preEstimate } from '../lib/format';
import { reveal, countTo } from '../lib/motion';
import { Logo } from '../lib/Logo';
const PAGE = 6;
type Sort = 'recent' | 'name' | 'size';
type Row = Library['playlists'][number] | Library['albums'][number] | Library['artists'][number];
const isPlaylist = (r: Row): r is Library['playlists'][number] => 'ownedByUser' in r;
const isAlbum = (r: Row): r is Library['albums'][number] => 'artist' in r && 'trackCount' in r;
export default function Select() {
  const [lib, setLib] = useState<Library | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [tab, setTab] = useState<Tab>('playlists');
  const [sort, setSort] = useState<Sort>('recent');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bigRef = useRef<HTMLDivElement>(null);
  useEffect(() => { api.library().then(l => { setLib(l); setSel(defaultSel(l)); }).catch(e => { if (e instanceof ApiError && e.status === 401) location.href = '/connect'; else setErr(e instanceof Error ? e.message : 'Could not read your library.'); }); }, []);
  useEffect(() => { if (listRef.current) reveal(listRef.current); }, [lib, tab, sort, expanded]);
  const t = lib && sel ? totals(lib, sel) : null;
  useEffect(() => { if (bigRef.current && t) countTo(bigRef.current, t.songs, n, true); }, [t?.songs]);
  if (err) return <p class="error error--hard" role="alert">{err}</p>;
  if (!lib || !sel || !t) return <div class="list choose__loading" aria-busy="true"><div class="row"><span class="row__sub cursor">Reading your library</span></div></div>;
  const rows: Row[] = tab === 'playlists' ? sortBy(lib.playlists, sort) : tab === 'albums' ? sortBy(lib.albums, sort) : sortBy(lib.artists, sort);
  const set = sel[tab] as Set<string>;
  const ids = rows.filter(r => !isPlaylist(r) || selectable(r)).map(r => r.id);
  const visible = expanded ? rows : rows.slice(0, PAGE);
  const hasLiked = tab === 'playlists' && lib.likedCount > 0;
  const tabSelected = set.size + (hasLiked && sel.liked ? 1 : 0), tabTotal = ids.length + (hasLiked ? 1 : 0);
  const tri = triState(tabSelected, tabTotal);
  const toggleAll = () => setSel({ ...sel, [tab]: new Set(tri === 'all' ? [] : ids), ...(tab === 'playlists' ? { liked: tri !== 'all' && lib.likedCount > 0 } : {}) });
  const toggle = (id: string, on: boolean, shift: boolean) => { setSel({ ...sel, [tab]: rangeToggle(ids, shift ? anchor.current : null, id, set, on) }); anchor.current = id; };
  async function start() {
    setBusy(true); setErr(null);
    try { const { id } = await api.createJob(toSelection(lib!, sel!)); location.href = `/t/${id}`; }
    catch (e) { if (e instanceof ApiError && e.status === 401) { location.href = '/connect'; return; } setErr(e instanceof ApiError ? e.message : 'Could not start the transfer.'); setBusy(false); }
  }
  const nothing = t.songs === 0 && t.albums === 0 && t.artists === 0;
  const sub = (r: Row) =>
    isPlaylist(r) ? (selectable(r) ? `by you${r.collaborative ? ' · collaborative' : ''}${r.isPublic === false ? ' · private' : ''}` : r.isAlgorithmic ? `by Spotify · regenerates` : `by ${r.owner} · can't be read by a personal Spotify app`) : isAlbum(r) ? r.artist : '';
  const countOf = (r: Row) => (isPlaylist(r) ? r.trackCount : isAlbum(r) ? r.trackCount : null);
  return <div class="choose">
    <div>
      <div class="tabs" role="tablist" aria-label="What to move">
        {(['playlists', 'albums', 'artists'] as Tab[]).map(k => <button role="tab" class="tab" aria-selected={tab === k} onClick={() => { setTab(k); setExpanded(false); anchor.current = null; }}>
          {k === 'playlists' ? 'Playlists' : k === 'albums' ? 'Albums' : <><span class="long">Followed </span><span class="cap">artists</span></>}
          <span class="count">{k === 'playlists' ? lib.playlists.length + (lib.likedCount ? 1 : 0) : k === 'albums' ? lib.albums.length : lib.artists.length}</span>
        </button>)}
      </div>
      <div class="toolbar">
        <label class="toolbar__all"><input type="checkbox" class="checkbox" checked={tri === 'all'} ref={el => { if (el) el.indeterminate = tri === 'some'; }} onChange={toggleAll} />Select all</label>
        <span class="meta toolbar__selected">{n(t.songs)} selected</span>
        <label class="meta toolbar__sort">sort: <select class="select" value={sort} onChange={e => setSort((e.target as HTMLSelectElement).value as Sort)}><option value="recent">recently played</option><option value="name">name</option><option value="size">size</option></select></label>
      </div>
      <div class="list" ref={listRef} role="group" aria-label={tab}>
        {hasLiked && <label class={`row is-selectable ${sel.liked ? '' : 'is-dim'}`}>
          <input type="checkbox" class="checkbox" checked={sel.liked} onChange={e => setSel({ ...sel, liked: (e.target as HTMLInputElement).checked })} />
          <span class="art"><Logo name="spotify" size={20} /></span>
          <span class="row__text"><div class="row__title">Liked songs</div><div class="row__sub">your saved library → likes + a private "Liked Songs" playlist</div></span>
          <span class="row__count">{n(lib.likedCount)} songs</span>
        </label>}
        {visible.map(r => {
          const locked = isPlaylist(r) && !selectable(r);
          const on = !locked && set.has(r.id);
          return <label class={`row ${locked ? 'is-dim is-locked' : 'is-selectable'} ${!locked && !on ? 'is-dim' : ''}`} key={r.id} title={locked ? 'Spotify does not let a personal app read playlists owned by other people' : undefined}>
            <input type="checkbox" class="checkbox" checked={on} disabled={locked} aria-label={r.name} onClick={e => { e.preventDefault(); toggle(r.id, !on, (e as MouseEvent).shiftKey); }} onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); toggle(r.id, !on, false); } }} />
            {r.image ? <img src={r.image} alt="" width="36" height="36" loading="lazy" /> : <span class="art"><Logo name="spotify" size={20} /></span>}
            <span class="row__text"><div class="row__title">{r.name}</div><div class="row__sub">{sub(r)}</div></span>
            {countOf(r) != null && <span class="row__count">{n(countOf(r)!)} songs</span>}
          </label>;
        })}
        {!expanded && rows.length > PAGE && <button class="row row__more" onClick={() => setExpanded(true)}>+ {n(rows.length - PAGE)} more {tab === 'artists' ? 'artists' : tab}</button>}
        {rows.length === 0 && !hasLiked && <div class="row"><span class="row__sub">Nothing here.</span></div>}
      </div>
    </div>
    <aside class="panel summary">
      <div class="summary__in">
        <div class="eyebrow">Selected</div>
        <div class="stat stat--big" ref={bigRef} data-value={t.songs}>{n(t.songs)}</div>
        <div class="summary__sub">songs across {t.playlists} playlist{t.playlists === 1 ? '' : 's'}</div>
        <dl class="kv hairline-top summary__kv">
          <dt>Playlists</dt><dd class="mono">{t.playlists} of {t.playlistsTotal}</dd>
          <dt>Saved albums</dt><dd class="mono">{t.albums} of {lib.albums.length}</dd>
          <dt>Followed artists</dt><dd class="mono">{t.artists} of {lib.artists.length}</dd>
          <dt>Estimated time</dt><dd class="mono c-fg">{preEstimate(t.songs)}</dd>
        </dl>
        <p class="note summary__hint">Songs other people already moved go faster.</p>
      </div>
      <div class="summary__bar"><span class="meta summary__bar-text">{t.playlists} playlist{t.playlists === 1 ? '' : 's'} · {n(t.songs)} songs</span><span class="meta c-fg">{preEstimate(t.songs)}</span></div>
      {err && <p class="error" role="alert">{err}</p>}
      <button class="btn btn--block summary__cta" onClick={start} disabled={busy || nothing}>{busy ? 'Starting…' : 'Start the transfer'}</button>
      <p class="note summary__note">You can close the tab once it starts. The transfer keeps running.</p>
    </aside>
  </div>;
}
