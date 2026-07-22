export const parseDate = (value: string | number | null): Date | null => {
  if (value === null || value === '') return null;

  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms);
  }

  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return new Date(n < 1e12 ? n * 1000 : n);
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export const formatDate = (date: Date | null): string =>
  date ? dateFmt.format(date) : '—';

export const downloadName = (id: number, description: string): string => {
  const firstLine = description.split('\n')[0]?.trim() ?? '';
  const slug = firstLine
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return slug ? `${id}-${slug}.mp4` : `${id}.mp4`;
};

export const formatSize = (bytes: number | null): string =>
  bytes == null ? '—' : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
