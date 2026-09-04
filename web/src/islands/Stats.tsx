// web/src/islands/Stats.tsx: the facts strip above the three steps. Nothing until 1,000 tracks have really been moved
// (D10: no invented numbers); then the live counters, counted up when the strip scrolls into view.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { StatsView } from '@shared/types';
import { compact } from '../lib/format';
import { countTo, onView } from '../lib/motion';
export default function Stats() {
  const [s, setS] = useState<StatsView | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then(setS)
      .catch(() => {});
  }, []);
  const live = !!s && s.tracksMoved >= 1000;
  useEffect(() => {
    if (!live || !ref.current) return;
    onView(ref.current, () => {
      ref
        .current!.querySelectorAll<HTMLElement>('[data-count]')
        .forEach((el) =>
          countTo(el, Number(el.dataset.count), (v) =>
            el.dataset.fmt === 'pct' ? `${(v / 10).toFixed(1)}%` : compact(v),
          ),
        );
    });
  }, [live]);
  if (!live) return null;
  return (
    <div class="stats" ref={ref}>
      <div>
        <b class="stat" data-count={s!.tracksMoved}>
          0
        </b>
        <span class="eyebrow">songs moved so far</span>
      </div>
      {s!.matchRate != null && (
        <div>
          <b class="stat c-accent" data-count={Math.round(s!.matchRate * 1000)} data-fmt="pct">
            0%
          </b>
          <span class="eyebrow">matched on the first try</span>
        </div>
      )}
      {s!.medianMinutes != null && (
        <div>
          <b class="stat">{s!.medianMinutes} min</b>
          <span class="eyebrow">for a typical library</span>
        </div>
      )}
      <div>
        <b class="stat">$0</b>
        <span class="eyebrow">now and later</span>
      </div>
    </div>
  );
}
