// web/src/islands/Stats.tsx: the four-cell strip under the hero. Server-rendered with facts that are true on day one;
// once 1,000 tracks have really been moved, the live counters take over the first cells (D10: no invented numbers).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { StatsView } from '@shared/types';
import { compact } from '../lib/format';
import { countTo, onView } from '../lib/motion';
const Cell = ({ v, l, accent = false }: { v: string; l: string; accent?: boolean }) => <div><b class={`stat ${accent ? 'c-accent' : ''}`}>{v}</b><span class="eyebrow">{l}</span></div>;
export default function Stats() {
  const [s, setS] = useState<StatsView | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { fetch('/api/stats').then(r => r.json()).then(setS).catch(() => {}); }, []);
  const live = !!s && s.tracksMoved >= 1000;
  useEffect(() => {
    if (!live || !ref.current) return;
    onView(ref.current, () => { ref.current!.querySelectorAll<HTMLElement>('[data-count]').forEach(el => countTo(el, Number(el.dataset.count), v => (el.dataset.fmt === 'pct' ? `${(v / 10).toFixed(1)}%` : compact(v)))); });
  }, [live]);
  return <div class="stats" ref={ref}>
    {live ? <>
      <div><b class="stat" data-count={s!.tracksMoved}>0</b><span class="eyebrow">songs moved so far</span></div>
      {s!.matchRate != null ? <div><b class="stat c-accent" data-count={Math.round(s!.matchRate * 1000)} data-fmt="pct">0%</b><span class="eyebrow">matched on the first try</span></div> : <Cell v="0" l="accounts to create" accent />}
      {s!.medianMinutes != null ? <div><b class="stat">{s!.medianMinutes} min</b><span class="eyebrow">for a typical library</span></div> : <Cell v="MIT" l="licensed, forkable" />}
    </> : <>
      <Cell v="0" l="accounts to create" />
      <Cell v="MIT" l="licensed, forkable" accent />
      <Cell v="24 h" l="until logins drop" />
    </>}
    <Cell v="$0" l="now and later" />
  </div>;
}
