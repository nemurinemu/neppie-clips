const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export const smoothScrollTo = (targetY: number, duration = 300) => {
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  const target = Math.max(0, Math.min(targetY, maxY));
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
