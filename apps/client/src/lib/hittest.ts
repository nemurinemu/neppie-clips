// Alpha hit-testing so clicks on the transparent padding around a peek image
// don't count. Same-origin images only (canvas would taint otherwise).
const cache = new Map<string, ImageData | null>();

const imageData = (img: HTMLImageElement): ImageData | null => {
  const src = img.currentSrc || img.src;
  const hit = cache.get(src);
  if (hit !== undefined) return hit;

  let data: ImageData | null = null;
  try {
    const { naturalWidth: w, naturalHeight: h } = img;
    if (w && h) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        data = ctx.getImageData(0, 0, w, h);
      }
    }
  } catch {
    data = null; // tainted or not ready — treat as always-hit
  }
  cache.set(src, data);
  return data;
};

// Parse a computed `transform` into 2D matrix parts [a, b, c, d, e, f].
const parseMatrix = (
  t: string,
): [number, number, number, number, number, number] => {
  const num = (p: string[], i: number) => Number(p[i] ?? 0);
  const g = /matrix\(([^)]+)\)/.exec(t)?.[1];
  if (g) {
    const p = g.split(',');
    return [num(p, 0), num(p, 1), num(p, 2), num(p, 3), num(p, 4), num(p, 5)];
  }
  const g3 = /matrix3d\(([^)]+)\)/.exec(t)?.[1];
  if (g3) {
    const p = g3.split(',');
    return [num(p, 0), num(p, 1), num(p, 4), num(p, 5), num(p, 12), num(p, 13)];
  }
  return [1, 0, 0, 1, 0, 0]; // "none"
};

type Xf = {
  w: number;
  h: number;
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  ox: number;
  oy: number;
};

const xfCache = new WeakMap<HTMLElement, Xf>();

// The element's transform + origin, cached until its rendered size changes.
// Only re-reads getComputedStyle on resize, so hovering stays cheap.
const transformOf = (img: HTMLImageElement): Xf => {
  const w = img.offsetWidth;
  const h = img.offsetHeight;
  const cached = xfCache.get(img);
  if (cached && cached.w === w && cached.h === h) return cached;

  const cs = getComputedStyle(img);
  const [a, b, c, d, e, f] = parseMatrix(cs.transform);
  const o = cs.transformOrigin.split(' ');
  const ox = parseFloat(o[0] ?? '');
  const oy = parseFloat(o[1] ?? '');
  const xf: Xf = {
    w,
    h,
    a,
    b,
    c,
    d,
    e,
    f,
    ox: Number.isFinite(ox) ? ox : w / 2,
    oy: Number.isFinite(oy) ? oy : h / 2,
  };
  xfCache.set(img, xf);
  return xf;
};

// True if the click landed on a non-transparent pixel of the event's <img>,
// accounting for any CSS transform (rotation/scale) on the element.
// Fails open (returns true) when it can't tell, so it never blocks legitimately.
export const isOpaqueAtEvent = (e: MouseEvent, threshold = 8): boolean => {
  const img = e.currentTarget;
  if (!(img instanceof HTMLImageElement) || !img.naturalWidth) return true;
  const data = imageData(img);
  if (!data) return true;

  const { w, h, a, b, c, d, e: te, f: tf, ox, oy } = transformOf(img);
  const det = a * d - c * b;
  if (!w || !h || !det) return true;

  // A local point L maps to screen: topLeft + O + M·(L − O) + (te, tf).
  // Find the untransformed top-left from the transformed bounding box.
  let minX = Infinity;
  let minY = Infinity;
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  for (const [cx, cy] of corners) {
    const vx = cx - ox;
    const vy = cy - oy;
    const x = ox + (a * vx + c * vy) + te;
    const y = oy + (b * vx + d * vy) + tf;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  const rect = img.getBoundingClientRect();
  const originX = rect.left - minX;
  const originY = rect.top - minY;

  // Invert: L = O + M⁻¹·(C − topLeft − O − translate).
  const ux = e.clientX - originX - ox - te;
  const uy = e.clientY - originY - oy - tf;
  const lx = ox + (d * ux - c * uy) / det;
  const ly = oy + (-b * ux + a * uy) / det;

  const px = Math.floor((lx / w) * data.width);
  const py = Math.floor((ly / h) * data.height);
  if (px < 0 || py < 0 || px >= data.width || py >= data.height) return false;

  const alpha = data.data[(py * data.width + px) * 4 + 3] ?? 255;
  return alpha > threshold;
};
