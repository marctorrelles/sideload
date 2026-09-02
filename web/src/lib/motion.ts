// web/src/lib/motion.ts — vanilla `motion` helpers. Purposeful and forward-only; nothing bounces. Every helper is a no-op under prefers-reduced-motion.
import { animate, stagger, inView } from 'motion';
const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1];
export const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Rows arrive like log lines. */
export function reveal(container: Element) {
  if (reduced()) return;
  const rows = Array.from(container.children) as HTMLElement[];
  if (!rows.length) return;
  animate(rows, { opacity: [0, 1], transform: ['translateY(6px)', 'none'] }, { duration: 0.35, delay: stagger(0.04), ease: EASE });
}
/** Count up to `to`; never down unless `allowDown` (progress must not jump backwards; selections may). */
export function countTo(el: HTMLElement, to: number, format: (v: number) => string, allowDown = false) {
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = String(to);
  if (reduced() || (!allowDown && to <= from) || to === from) { el.textContent = format(to); return; }
  animate(from, to, { duration: 0.6, ease: 'easeOut', onUpdate: v => { el.textContent = format(Math.round(v)); } });
}
export function onView(el: Element, cb: () => void) { if (reduced()) return cb(); inView(el, () => { cb(); }, { amount: 0.4 }); }
/** Collapse a row (review item resolved). Resolves when done. */
export async function collapse(el: HTMLElement) {
  if (reduced()) { el.remove(); return; }
  el.style.overflow = 'hidden';
  await animate(el, { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }, { duration: 0.28, ease: EASE }).finished;
  el.remove();
}
/** Crossfade a status label when its text changes. */
export function crossfade(el: HTMLElement) { if (!reduced()) animate(el, { opacity: [0, 1] }, { duration: 0.2 }); }
export function flash(el: HTMLElement, text: string, ms = 1500) { const prev = el.textContent; el.textContent = text; setTimeout(() => { el.textContent = prev; }, ms); }
