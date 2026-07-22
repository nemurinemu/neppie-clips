import fs from 'node:fs';

// Serve the built index.html, re-reading only when the file changes on disk
// (so `deploy:client` is picked up without restarting the API).
let cache: { mtimeMs: number; html: string } | null = null;

export const readIndexHtml = (indexPath: string): string => {
  const st = fs.statSync(indexPath);
  if (!cache || cache.mtimeMs !== st.mtimeMs) {
    cache = { mtimeMs: st.mtimeMs, html: fs.readFileSync(indexPath, 'utf8') };
  }
  return cache.html;
};

const escapeAttr = (s: string): string =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeKey = (k: string): string => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rewrite the content="" of the <meta property|name="key"> tag (tag may span
// lines; [^>] matches newlines up to the first '>').
const setMeta = (html: string, key: string, val: string): string => {
  const esc = escapeAttr(val);
  const re = new RegExp(
    `<meta\\b[^>]*?\\b(?:property|name)=["']${escapeKey(key)}["'][^>]*?>`,
    'i',
  );
  return html.replace(re, (tag) =>
    /\bcontent=/.test(tag)
      ? tag.replace(/\bcontent=(["']).*?\1/i, `content="${esc}"`)
      : tag.replace(/\s*\/?>$/, ` content="${esc}">`),
  );
};

const removeMeta = (html: string, key: string): string =>
  html.replace(
    new RegExp(
      `\\s*<meta\\b[^>]*?\\b(?:property|name)=["']${escapeKey(key)}["'][^>]*?>`,
      'gi',
    ),
    '',
  );

export interface MetaOverrides {
  title: string;
  image: string;
  url: string;
}

// Only the preview title, image and url are per-clip. The <title> (browser tab)
// and description meta stay the site defaults — the SPA never resets the tab
// title on close, so changing it would leave a stale name after closing a clip.
export const injectMeta = (html: string, o: MetaOverrides): string => {
  let out = setMeta(html, 'og:title', o.title);
  out = setMeta(out, 'twitter:title', o.title);
  out = setMeta(out, 'og:image', o.image);
  out = setMeta(out, 'twitter:image', o.image);
  out = setMeta(out, 'og:url', o.url);
  // A clip thumbnail isn't the banner's size — drop the stale dimension hints.
  out = removeMeta(out, 'og:image:width');
  out = removeMeta(out, 'og:image:height');
  return out;
};
