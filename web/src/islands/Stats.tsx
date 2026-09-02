// web/src/islands/Stats.tsx — hero stat row from the real counter (D10). Hidden until ≥ 1,000 tracks have been moved: no invented numbers.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { StatsView } from '@shared/types';
import { compact } from '../lib/format';
import { countTo, onView } from '../lib/motion';
export default function Stats() {
  const [s, setS] = useState<StatsView | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { fetch('/api/stats').then(r => r.json()).then(setS).catch(() => {}); }, []);
  useEffect(() => {
    if (!s || !ref.current) return;
    onView(ref.current, () => { ref.current!.querySelectorAll<HTMLElement>('[data-count]').forEach(el => countTo(el, Number(el.dataset.count), v => (el.dataset.fmt === 'pct' ? `${(v / 10).toFixed(1)}%` : compact(v)))); });
  }, [s]);
  if (!s || s.tracksMoved < 1000) return null;
  return <div class="stats hairline-top" ref={ref}>
    <div><span class="stat" data-count={s.tracksMoved}>0</span><span class="eyebrow">tracks moved</span></div>
    {s.matchRate != null && <div><span class="stat" data-count={Math.round(s.matchRate * 1000)} data-fmt="pct">0%</span><span class="eyebrow">matched first try</span></div>}
    {s.medianMinutes != null && <div><span class="stat">{s.medianMinutes} min</span><span class="eyebrow">typical library</span></div>}
  </div>;
}
