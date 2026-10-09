const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const MEDIA_BASE = import.meta.env.VITE_MEDIA_BASE ?? '/media';
// Videos can live on a separate origin (served straight from the VPS, off the
// CDN). Empty/unset falls back to MEDIA_BASE, keeping dev same-origin.
const VIDEO_BASE = import.meta.env.VITE_VIDEO_BASE || MEDIA_BASE;

// Media is cached for days under a fixed name; the version changes when a
// clip is re-downloaded, so browsers fetch the new file.
const versioned = (url: string, version?: number | null) =>
  version ? `${url}?v=${version}` : url;

export const config = {
  videosEndpoint: `${API_BASE}/videos`,
  thumbUrl: (mediaId: number, version?: number | null) =>
    versioned(`${MEDIA_BASE}/thumbnails/${mediaId}.webp`, version),
  videoUrl: (mediaId: number, version?: number | null) =>
    versioned(`${VIDEO_BASE}/videos/${mediaId}.mp4`, version),
  verticalUrl: (mediaId: number, version?: number | null) =>
    versioned(`${VIDEO_BASE}/videos/${mediaId}_vertical.mp4`, version),
};
