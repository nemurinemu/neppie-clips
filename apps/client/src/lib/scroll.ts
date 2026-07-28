const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const clampY = (y: number) =>
  Math.max(
    0,
    Math.min(y, document.documentElement.scrollHeight - window.innerHeight),
  );

export const smoothScrollTo = (targetY: number, duration = 300) => {
  const target = clampY(targetY);
  const startY = window.scrollY;
  const diff = target - startY;
  if (Math.abs(diff) < 2) return;

  let start: number | null = null;
  const step = (ts: number) => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / duration);
    window.scrollTo(0, startY + diff * easeOutCubic(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

// Extra pin time granted after each layout-shifting event (rotation, address
// bar, viewport resize) so a late reflow can't leave us parked off-target.
const SETTLE_MS = 400;
// Ceiling on those extensions, so a browser that streams resize events (address
// bar animations) can't keep the page pinned indefinitely.
const MAX_PIN_MS = 3000;

/**
 * Scroll to a target that is re-measured every frame, then hold it there while
 * the layout settles. Unlike smoothScrollTo this survives a reflow mid-flight —
 * e.g. a phone rotating back to portrait after leaving landscape fullscreen,
 * which moves the target by about a screen height. Any user scroll input
 * cancels it immediately.
 */
export const scrollToAnchor = (
  anchor: () => number | null,
  { duration = 320, hold = 0 } = {},
) => {
  if (anchor() === null) return;

  const startY = window.scrollY;
  let raf = 0;
  let start: number | null = null;
  let holdUntil = 0;
  let stopped = false;

  const extend = () => {
    const now = performance.now();
    if (start !== null && now > start + MAX_PIN_MS) return;
    holdUntil = Math.max(holdUntil, now + SETTLE_MS);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('wheel', stop);
    window.removeEventListener('keydown', stop);
    window.removeEventListener('resize', extend);
    window.removeEventListener('orientationchange', extend);
    screen.orientation?.removeEventListener('change', extend);
    visualViewport?.removeEventListener('resize', extend);
  };

  const step = (ts: number) => {
    if (start === null) {
      start = ts;
      holdUntil = ts + duration + hold;
    }
    const target = anchor();
    if (target === null) {
      stop();
      return;
    }
    const t = Math.min(1, (ts - start) / duration);
    // Ease *back* from the target so a target that moves mid-animation still
    // lands exactly, with the correction shrinking as we approach it.
    const y = clampY(target - (target - startY) * (1 - easeOutCubic(t)));
    if (Math.abs(y - window.scrollY) >= 1) window.scrollTo(0, y);
    if (t < 1 || ts < holdUntil) raf = requestAnimationFrame(step);
    else stop();
  };

  window.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('wheel', stop, { passive: true });
  window.addEventListener('keydown', stop);
  window.addEventListener('resize', extend);
  window.addEventListener('orientationchange', extend);
  screen.orientation?.addEventListener('change', extend);
  visualViewport?.addEventListener('resize', extend);
  raf = requestAnimationFrame(step);
};
