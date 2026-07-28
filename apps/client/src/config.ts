const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const MEDIA_BASE = import.meta.env.VITE_MEDIA_BASE ?? '/media';
// Videos can live on a separate origin (served straight from the VPS, off the
// CDN). Empty/unset falls back to MEDIA_BASE, keeping dev same-origin.
const VIDEO_BASE = import.meta.env.VITE_VIDEO_BASE || MEDIA_BASE;

export const config = {
  videosEndpoint: `${API_BASE}/videos`,
  thumbUrl: (mediaId: number) => `${MEDIA_BASE}/thumbnails/${mediaId}.webp`,
  videoUrl: (mediaId: number) => `${VIDEO_BASE}/videos/${mediaId}.mp4`,
};
