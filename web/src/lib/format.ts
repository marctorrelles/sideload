// web/src/lib/format.ts: number/time formatting shared by the islands.
export const n = (v: number) => new Intl.NumberFormat('en-US').format(v);
export const compact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `${Math.round(v / 1000)}k` : n(v);
export const pct = (a: number, b: number) => (b ? Math.floor((a / b) * 100) : 0);
export function eta(seconds: number | null): string {
  if (seconds == null) return 'estimating…';
  if (seconds < 60) return 'under a minute left';
  const m = Math.round(seconds / 60);
  if (m < 60) return `about ${m} minute${m === 1 ? '' : 's'} left`;
  const h = Math.floor(m / 60),
    r = m % 60;
  return `about ${h} h${r ? ` ${r} min` : ''} left`;
}
/** Pre-start estimate: 45 searches/min measured (D11). Songs other people already moved are cache hits and go faster. */
export const preEstimate = (tracks: number) => {
  const m = Math.max(1, Math.round(tracks / 45));
  return m < 60 ? `~${m} min` : `~${Math.round((m / 60) * 2) / 2} h`;
};
export function duration(ms: number): string {
  const s = Math.round(ms / 1000),
    m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m === 0 ? `${s} s` : `${m} min ${s % 60} s`;
}
