// web/src/lib/motion.ts: vanilla motion helpers (CSS animations in motion.css + rAF). Purposeful and forward-only; nothing bounces.
// No animation library: the Web Animations path (`commitStyles`) writes a style attribute, which the CSP's style-src blocks.
// Every helper is a no-op under prefers-reduced-motion.
export const reduced = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Rows arrive like log lines: `.reveal > *` fades each child up, staggered by --i (capped so long lists don't wait). */
export function reveal(container: Element) {
  if (reduced()) return;
  Array.from(container.children).forEach((row, i) =>
    (row as HTMLElement).style.setProperty('--i', String(Math.min(i, 12))),
  );
  container.classList.add('reveal');
}
/** Count up to `to`; never down unless `allowDown` (progress must not jump backwards; selections may). */
export function countTo(el: HTMLElement, to: number, format: (v: number) => string, allowDown = false) {
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = String(to);
  if (reduced() || (!allowDown && to <= from) || to === from) {
    el.textContent = format(to);
    return;
  }
  const run = String(Date.now());
  el.dataset.run = run; // a newer call takes over mid-flight
  const t0 = performance.now();
  const step = (now: number) => {
    if (el.dataset.run !== run) return;
    const t = Math.min(1, (now - t0) / 600);
    el.textContent = format(Math.round(from + (to - from) * easeOut(t)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
export function onView(el: Element, cb: () => void) {
  if (reduced() || typeof IntersectionObserver === 'undefined') return cb();
  const io = new IntersectionObserver(
    (es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        cb();
      }
    },
    { threshold: 0.4 },
  );
  io.observe(el);
}
/** Collapse a row (review item resolved). Resolves when the row is gone. */
export function collapse(el: HTMLElement): Promise<void> {
  if (reduced()) {
    el.remove();
    return Promise.resolve();
  }
  el.style.height = `${el.offsetHeight}px`;
  return new Promise((done) => {
    const finish = () => {
      if (el.isConnected) el.remove();
      done();
    };
    requestAnimationFrame(() => {
      el.classList.add('collapsing');
      el.style.height = '0';
    });
    el.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 400); // transitionend is not guaranteed (display changes, hidden tabs)
  });
}
/** Crossfade a status label when its text changes. */
export function crossfade(el: HTMLElement) {
  if (reduced()) return;
  el.classList.remove('xfade');
  void el.offsetWidth;
  el.classList.add('xfade');
}
export function flash(el: HTMLElement, text: string, ms = 1500) {
  const prev = el.textContent;
  el.textContent = text;
  setTimeout(() => {
    el.textContent = prev;
  }, ms);
}
